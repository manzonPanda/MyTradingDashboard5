from flask import Flask, jsonify, request
import eventlet

eventlet.monkey_patch()

from flask_cors import CORS
from flask_socketio import SocketIO
import MetaTrader5 as mt5
import threading
import os
import requests
import mss
import mss.tools
import win32gui
import win32api
import win32con
import win32process
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta, timezone
from dateutil import tz
from collections import defaultdict
import pandas as pd
from pandas.errors import EmptyDataError
from zoneinfo import ZoneInfo
from math import isclose
import numpy as np
from threading import Timer
load_dotenv()

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")  # Allow WebSocket connections
local_tz = ZoneInfo("Asia/Manila")
reconnect_in_progress = False

MASTER = r"C:\Program Files\MetaTrader 5\terminal64.exe"

if not mt5.initialize(path=MASTER):
    raise Exception(f"❌MT5 Initialization failed: {mt5.last_error()}")
         
# Store previously seen trade tickets to detect new ones
seen_tickets = set()
seen_orders = set()

# Keep track of currently open position tickets
last_positions = {}

SUPABASE_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
SUPABASE_STORAGE_BUCKET = os.getenv('SUPABASE_STORAGE_BUCKET', 'trade-screenshots')
MT5_WINDOW_TITLE = os.getenv('MT5_WINDOW_TITLE', 'MetaTrader 5')


def find_mt5_window():
    matches = []
    visible_titles = []
    configured_title = MT5_WINDOW_TITLE.casefold()
    terminal_path = os.path.normcase(os.path.abspath(MASTER))

    def collect(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return

        title = win32gui.GetWindowText(hwnd).strip()
        if title:
            visible_titles.append(title)
        normalized_title = title.casefold()
        title_matches = configured_title in normalized_title or 'metatrader' in normalized_title
        _, process_id = win32process.GetWindowThreadProcessId(hwnd)
        process_matches = False
        try:
            process = win32api.OpenProcess(win32con.PROCESS_QUERY_LIMITED_INFORMATION, False, process_id)
            try:
                process_path = win32process.GetModuleFileNameEx(process, 0)
                process_matches = os.path.normcase(os.path.abspath(process_path)) == terminal_path
            finally:
                win32api.CloseHandle(process)
        except win32api.error:
            pass

        if title_matches or process_matches:
            matches.append(hwnd)

    win32gui.EnumWindows(collect, None)
    if not matches:
        print(f'⚠️ No MT5 window matched {MT5_WINDOW_TITLE!r}. Visible windows: {visible_titles[:20]}')
        return None

    for hwnd in matches:
        if not win32gui.IsIconic(hwnd):
            return hwnd
    return matches[0]


def upload_trade_screenshot(ticket: int, symbol: str):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print('⚠️ Screenshot upload skipped: Supabase server credentials are not configured')
        return None

    hwnd = find_mt5_window()
    if not hwnd:
        print('⚠️ Screenshot upload skipped: MT5 window was not found')
        return None

    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width = right - left
    height = bottom - top
    if width <= 0 or height <= 0:
        print('⚠️ Screenshot upload skipped: MT5 window has invalid bounds')
        return None

    with mss.MSS() as screen:
        image = screen.grab({'left': left, 'top': top, 'width': width, 'height': height})
        image_bytes = mss.tools.to_png(image.rgb, image.size)

    safe_symbol = ''.join(character if character.isalnum() or character in ('-', '_') else '_' for character in symbol)
    storage_path = f'{ticket}/{safe_symbol}.png'
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'image/png',
        'x-upsert': 'true'
    }
    upload_url = f'{SUPABASE_URL}/storage/v1/object/{SUPABASE_STORAGE_BUCKET}/{storage_path}'
    upload_response = requests.post(upload_url, headers=headers, data=image_bytes, timeout=30)
    upload_response.raise_for_status()

    metadata_url = f'{SUPABASE_URL}/rest/v1/trade_screenshots'
    metadata_response = requests.post(
        metadata_url,
        headers={**headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'},
        json={'ticket': str(ticket), 'symbol': symbol, 'storage_path': storage_path},
        timeout=30
    )
    metadata_response.raise_for_status()

    signed_url = f'{SUPABASE_URL}/storage/v1/object/sign/{SUPABASE_STORAGE_BUCKET}/{storage_path}'
    signed_response = requests.post(
        signed_url,
        headers={
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json'
        },
        json={'expiresIn': 86400},
        timeout=30
    )
    signed_response.raise_for_status()
    signed_path = signed_response.json().get('signedURL')
    if not signed_path:
        return None
    if signed_path.startswith('/storage/v1/'):
        return f'{SUPABASE_URL}{signed_path}'
    if signed_path.startswith('/'):
        return f'{SUPABASE_URL}/storage/v1{signed_path}'
    return signed_path

def emit_trade_opened(pos, open_time_str, risk_usd):
    screenshot_url = None
    try:
        screenshot_url = upload_trade_screenshot(pos.ticket, pos.symbol)
    except Exception as error:
        print(f'⚠️ Unable to capture/upload screenshot for ticket {pos.ticket}: {error}')

    socketio.emit('trade_opened', {
        'ticket': pos.ticket,
        'symbol': pos.symbol,
        'volume': pos.volume,
        'type': pos.type,
        'price_open': pos.price_open,
        'sl': pos.sl,
        'tp': pos.tp,
        'profit': pos.profit,
        'time_open': open_time_str,
        'risk_usd': round(risk_usd, 2) if risk_usd is not None else None,
        'screenshot_url': screenshot_url,
        'object': pos
    })


def watch_trades():
    global seen_tickets, last_positions, seen_orders, pendingOrders
    print("✅ Trade watcher thread started...")

    while True:
        pendingOrders = mt5.orders_get()
        current_orders = {order.ticket: order for order in mt5.orders_get() or []}
        # Get current open positions
        current_positions = {p.ticket: p for p in mt5.positions_get() or []}

        # Emit price update for all current open trades
        for ticket, pos in current_positions.items():
            sl_value = None
            tp_value = None
            if pos.sl and pos.sl != 0:
                sl_value = mt5.order_calc_profit(
                    pos.type,
                    pos.symbol,
                    pos.volume,
                    pos.price_open,
                    pos.sl
                )
            if pos.tp and pos.tp != 0:
                tp_value = mt5.order_calc_profit(
                    pos.type,
                    pos.symbol,
                    pos.volume,
                    pos.price_open,
                    pos.tp
                )
            risk_1R = abs(sl_value) if sl_value else None
            current_R = None
            if risk_1R and risk_1R != 0:
                current_R = round(pos.profit / risk_1R, 2)

            socketio.emit('price_update', {
                "ticket": pos.ticket,
                "symbol": pos.symbol,
                "volume": pos.volume,
                "type": pos.type,
                "price_open": pos.price_open,
                "price_current": pos.price_current,
                "profit": pos.profit,
                "time": pos.time,
                "sl": pos.sl if pos.sl != 0 else None,
                "tp": pos.tp if pos.tp != 0 else None,
                "sl_value": sl_value,
                "tp_value": tp_value,
                "live_rr": current_R
            })

        # Detect new open positions
        for ticket, pos in current_positions.items():
            if ticket not in seen_tickets:
                seen_tickets.add(ticket)
                print(f"🟢 New OPEN trade: {pos.symbol} @ {pos.price_open}")

                # Keep time in MT5 UTC (no local conversion)
                open_time_str = datetime.fromtimestamp(pos.time, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

                # 💰 Calculate risk in USD
                risk_usd = None
                symbol_info = mt5.symbol_info(pos.symbol)
                if symbol_info is not None and pos.sl > 0:
                    point = symbol_info.point
                    tick_value = symbol_info.trade_tick_value
                    points = abs(pos.price_open - pos.sl) / point
                    risk_usd = points * tick_value * pos.volume
                else:
                    print("⚠�� Cannot calculate risk (missing SL or symbol info)")

                socketio.start_background_task(emit_trade_opened, pos, open_time_str, risk_usd)

        # Detect closed positions
        closed_tickets = set(last_positions.keys()) - set(current_positions.keys())
        for ticket in closed_tickets:
            closed_pos = last_positions[ticket]
            # print(f"🔴 CLOSED trade: {closed_pos.symbol} @ {closed_pos.price_open}")

            # Default fallback: current time
            close_time_str = ""

            # Try to get accurate close time from MT5 history using pos time window
            start_time = datetime.fromtimestamp(closed_pos.time) - timedelta(minutes=30)
            end_time = datetime.fromtimestamp(closed_pos.time) + timedelta(hours=12)
            # print(f"🔍 Searching deals from {start_time} to {end_time}")

            deals = mt5.history_deals_get(start_time, end_time)
            if deals:
                for d in deals:
                    if d.position_id == closed_pos.ticket and d.entry == mt5.DEAL_ENTRY_OUT:
                        print("found", d)
                        close_time_str = datetime.fromtimestamp(d.time, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
                        break
            # else:
                # print("⚠️ No deals returned from history_deals_get")

            # ✅ Calculate reward:risk ratio (R)
            sl = closed_pos.sl
            price_open = closed_pos.price_open
            price_close = closed_pos.price_current
            reward_risk_ratio = None

            if sl and sl > 0 and price_open != sl:
                if closed_pos.type == mt5.ORDER_TYPE_BUY:
                    risk_per_lot = price_open - sl
                    reward_per_lot = price_close - price_open
                else:  # sell
                    risk_per_lot = sl - price_open
                    reward_per_lot = price_open - price_close

                if risk_per_lot != 0:
                    raw_ratio = reward_per_lot / risk_per_lot
                    reward_risk_ratio = f"{raw_ratio:+.2f}R"  # formatted with 'R'
                else:
                    reward_risk_ratio = "N/A"
            else:
                reward_risk_ratio = "N/A"

            socketio.emit('trade_closed', {
                "ticket": closed_pos.ticket,
                "symbol": closed_pos.symbol,
                "volume": closed_pos.volume,
                "type": closed_pos.type,
                "price_open": closed_pos.price_open,
                "price_close": closed_pos.price_current,
                "profit": closed_pos.profit,
                "time_close": close_time_str,
                "reward_risk_ratio": reward_risk_ratio,
                "object": closed_pos
            })

        # Detect NEW pending orders
        for ticket, order in current_orders.items():
            if ticket not in seen_orders:
                seen_orders.add(ticket)

                print(f"🟡 New pending order: {order.symbol}")

                order_time = datetime.fromtimestamp(
                    order.time_setup, tz=timezone.utc
                ).strftime('%Y-%m-%d %H:%M:%S')

                socketio.emit("pending_order", {
                    "ticket": order.ticket,
                    "symbol": order.symbol,
                    "volume": order.volume_current,
                    "type": order.type,
                    "price_open": order.price_open,
                    "sl": order.sl,
                    "tp": order.tp,
                    "time_setup": order_time,
                    "magic": order.magic,
                    "comment": order.comment
                })

        # Detect DELETED pending orders
        for ticket in list(seen_orders):
            if ticket not in current_orders:
                seen_orders.remove(ticket)
                print(f"❌ Pending order DELETED: {ticket}")

                socketio.emit('pending_deleted', {
                    "ticket": ticket
                })

        # Update the last seen positions
        last_positions = current_positions.copy()

        # time.sleep(1)
        time.sleep(0.1)   # 100ms polling


# Start background thread
threading.Thread(target=watch_trades, daemon=True).start()

@app.route("/api/open_trades", methods=["GET"])
def get_open_trades():
    positions = mt5.positions_get()
    if positions is None:
        return jsonify({"error": "No open trades or connection error"}), 500

    results = []
    for p in positions:
        results.append({
            "ticket": p.ticket,
            "symbol": p.symbol,
            "volume": p.volume,
            "type": p.type,
            "price_open": p.price_open,
            "sl": p.sl,
            "tp": p.tp,
            "profit": p.profit,
            "time": p.time,
            "object":p
        })
    return jsonify(results)


@app.route("/api/history", methods=["GET"])
def full_history():
    if mt5.terminal_info() is None:
        return jsonify({"error": "MT5 terminal is unavailable"}), 503

    from_date = datetime(2000, 1, 1)
    to_date = datetime.now()

    # 📕 Closed trades via deals
    deals = mt5.history_deals_get(from_date, to_date)
    df_closed = []
    if deals:
        df_deals = pd.DataFrame([d._asdict() for d in deals])
        df_deals['time'] = pd.to_datetime(df_deals['time'], unit='s')

        df_entry = df_deals[df_deals['entry'] == mt5.DEAL_ENTRY_IN][[
            'position_id', 'time', 'price', 'type', 'volume', 'symbol'
        ]].rename(columns={
            'time': 'time_open',
            'price': 'entry_price',
            'type': 'trade_type'
        })

        df_exit = df_deals[df_deals['entry'] == mt5.DEAL_ENTRY_OUT][[
            'position_id', 'time', 'price', 'profit'
        ]].rename(columns={
            'time': 'time_close',
            'price': 'exit_price'
        })

        df_merged = pd.merge(df_exit, df_entry, on='position_id', how='left')

        df_commission = df_deals[df_deals['commission'] != 0].groupby('position_id')['commission'].sum().reset_index()
        df_merged = df_merged.merge(df_commission, on='position_id', how='left')
        df_merged['commission'] = df_merged['commission'].fillna(0)

        # 🎯 SL/TP from orders
        orders = mt5.history_orders_get(from_date, to_date)
        sl_tp_map = {o.ticket: {'sl': o.sl, 'tp': o.tp} for o in orders} if orders else {}

        def get_order_sl_tp(order_id):
            data = sl_tp_map.get(order_id, {})
            return data.get('sl', 0), data.get('tp', 0)

        df_merged['order'] = df_merged['position_id']
        df_merged[['sl', 'tp']] = df_merged['order'].apply(lambda oid: pd.Series(get_order_sl_tp(oid)))

        def compute_risk_usd(row):
            entry = row['entry_price']
            sl = row['sl']
            vol = row['volume']
            symbol = row['symbol']
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info and sl > 0:
                point = symbol_info.point
                tick_value = symbol_info.trade_tick_value
                points = abs(entry - sl) / point
                return round(points * tick_value * vol, 2)
            return None

        df_merged['risk_usd'] = df_merged.apply(compute_risk_usd, axis=1)

        def compute_rr(row):
            risk = row['risk_usd']
            profit = row['profit']
            if risk and risk > 0:
                return f"{round(profit / risk, 2):+0.2f}R"
            return None

        df_merged['reward_risk_ratio'] = df_merged.apply(compute_rr, axis=1)
        df_merged['time_open'] = df_merged['time_open'].astype(str)
        df_merged['time_close'] = df_merged['time_close'].astype(str)
        df_merged['status'] = 'closed'

        df_closed = df_merged[[
            'position_id', 'symbol', 'volume', 'trade_type', 'entry_price',
            'exit_price', 'profit', 'commission', 'sl', 'tp',
            'risk_usd', 'reward_risk_ratio',
            'time_open', 'time_close', 'status'
        ]].to_dict(orient='records')

    # 📗 Open trades via current positions
    positions = mt5.positions_get()
    if positions is None:
        return jsonify({"error": "MT5 positions are unavailable"}), 503

    df_open = []
    if positions:
        for pos in positions:
            symbol_info = mt5.symbol_info(pos.symbol)
            risk_usd = None
            if symbol_info and pos.sl > 0:
                point = symbol_info.point
                tick_value = symbol_info.trade_tick_value
                points = abs(pos.price_open - pos.sl) / point
                risk_usd = round(points * tick_value * pos.volume, 2)

            df_open.append({
                'position_id': pos.ticket,
                'symbol': pos.symbol,
                'volume': pos.volume,
                'trade_type': pos.type,
                'entry_price': pos.price_open,
                'exit_price': None,
                'profit': pos.profit,
                'commission': 0,
                'sl': pos.sl,
                'tp': pos.tp,
                'risk_usd': risk_usd,
                'reward_risk_ratio': None,
                'time_open': datetime.fromtimestamp(pos.time, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
                'time_close': None,
                'status': 'open'
            })

    # 🧾 Combine both
    all_trades = df_closed + df_open

    # pandas coerces missing values into float('nan') inside the DataFrame, and
    # Flask's jsonify would serialize those as the literal `NaN` (invalid JSON).
    # That breaks the frontend's JSON.parse and aborts the entire history load.
    # Replace non-finite floats / pandas NaT with JSON null so every trade
    # (including the last object) round-trips cleanly.
    def sanitize_value(value):
        if isinstance(value, float) and not np.isfinite(value):
            return None
        if isinstance(value, str) and value == 'NaT':
            return None
        return value

    all_trades = [
        {key: sanitize_value(val) for key, val in trade.items()}
        for trade in all_trades
    ]
    return jsonify(all_trades)

@app.route("/api/health", methods=["GET"])
def health_check():
    info = mt5.terminal_info()
    mt5_connected = info is not None

    return jsonify({
        'status': 'healthy' if mt5_connected else 'unhealthy',
        'service': 'MT5_API',
        'mt5_connected': mt5_connected,
        'timestamp': datetime.now().isoformat(),
        'port': 5000
    })


def reconnect_mt5():
    global reconnect_in_progress

    if reconnect_in_progress:
        return False

    reconnect_in_progress = True
    try:
        mt5.shutdown()
        time.sleep(1)
        if not mt5.initialize(path=MASTER):
            return False

        info = mt5.account_info()
        if info:
            socketio.emit('account_info', {
                'login': info.login,
                'name': info.name,
                'server': info.server,
                'balance': info.balance,
                'starting_balance': info.balance,
                'info': info._asdict()
            })
        return True
    finally:
        reconnect_in_progress = False

@app.route("/api/start-reconnect", methods=["POST"])
def start_reconnect():
    eventlet.spawn_n(reconnect_mt5)
    return jsonify({"message": "MT5 reconnection started"})

def close_position(position):
    symbol_info = mt5.symbol_info(position.symbol)
    tick = mt5.symbol_info_tick(position.symbol)

    if symbol_info is None or tick is None:
        return {
            "ticket": position.ticket,
            "success": False,
            "error": "Market price unavailable"
        }

    # Send the opposite order to close the position
    if position.type == mt5.ORDER_TYPE_BUY:
        order_type = mt5.ORDER_TYPE_SELL
        price = tick.bid
    else:
        order_type = mt5.ORDER_TYPE_BUY
        price = tick.ask

    # Use IOC if supported; otherwise use FOK
    filling_mode = (
        mt5.ORDER_FILLING_IOC
        if symbol_info.filling_mode & mt5.ORDER_FILLING_IOC
        else mt5.ORDER_FILLING_FOK
    )

    request_data = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": position.symbol,
        "volume": position.volume,
        "type": order_type,
        "position": position.ticket,
        "price": price,
        "deviation": 20,
        "magic": 100,
        "comment": "",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode,
    }

    result = mt5.order_send(request_data)

    if result is None:
        return {
            "ticket": position.ticket,
            "success": False,
            "error": "MT5 order_send returned no result",
            "last_error": str(mt5.last_error())
        }

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        return {
            "ticket": position.ticket,
            "success": False,
            "error": "Close failed",
            "retcode": result.retcode,
            "comment": result.comment
        }

    return {
        "ticket": position.ticket,
        "success": True
    }


@app.route('/api/close_trade', methods=['POST'])
def close_trade():
    data = request.json or {}
    ticket = data.get("ticket")

    if not ticket:
        return jsonify({"error": "Ticket is required"}), 400

    positions = mt5.positions_get(ticket=ticket)
    if not positions:
        return jsonify({"error": "Position not found"}), 404

    result = close_position(positions[0])
    return jsonify(result), 200 if result.get("success") else 502


@app.route('/api/close_all_trades', methods=['POST'])
def close_all_trades():
    positions = mt5.positions_get() or []
    results = [close_position(position) for position in positions]
    failed = [result for result in results if not result.get("success")]

    return jsonify({
        "success": not failed,
        "requested": len(positions),
        "closed": len(positions) - len(failed),
        "failed": failed
    }), 200 if not failed else 502

@socketio.on('connect')
def on_connect():
    from datetime import datetime
    info = mt5.account_info()
    starting_balance = None

    if info:
        utc_from = datetime(2000, 1, 1)
        utc_to = datetime.now()
        deals = mt5.history_deals_get(utc_from, utc_to)

        if deals:
            for deal in deals:
                if deal.type == mt5.DEAL_TYPE_BALANCE:
                    if deal.profit and deal.profit > 0:
                        starting_balance = deal.profit
                    elif deal.price and deal.price > 0:
                        starting_balance = deal.price
                    elif deal.volume and deal.volume > 0:
                        starting_balance = deal.volume
                    if starting_balance:
                        break

        if starting_balance is None:
            starting_balance = info.balance

        payload = {
            'login': info.login,
            'name': info.name,
            'server': info.server,
            'balance': info.balance,
            'starting_balance': starting_balance,
            'info': info._asdict()
        }

    else:
        # Send empty but defined values so Angular never sees "undefined"
        payload = {
            'login': None,
            'name': None,
            'server': None,
            'balance': 0,
            'starting_balance': 0,
            'info': {}
        }

    socketio.emit('account_info', payload)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, use_reloader=False)
