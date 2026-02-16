from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO
import MetaTrader5 as mt5
import threading
import time
import eventlet
from datetime import datetime, timedelta, timezone
from dateutil import tz
from collections import defaultdict
import pandas as pd
from pandas.errors import EmptyDataError
from zoneinfo import ZoneInfo
from math import isclose
import numpy as np
from threading import Timer
import eventlet

eventlet.monkey_patch()  # <- important for eventlet

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")  # Allow WebSocket connections
local_tz = ZoneInfo("Asia/Manila")
last_disconnect_time = None
reconnect_delay = 30  # seconds

if not mt5.initialize():
    raise Exception(f"❌MT5 Initialization failed: {mt5.last_error()}")
         
# Store previously seen trade tickets to detect new ones
seen_tickets = set()

# Keep track of currently open position tickets
last_positions = {}
 
def watch_trades():
    global seen_tickets, last_positions
    print("✅ Trade watcher thread started...")

    while True:
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

                socketio.emit('trade_opened', {
                    "ticket": pos.ticket,
                    "symbol": pos.symbol,
                    "volume": pos.volume,
                    "type": pos.type,
                    "price_open": pos.price_open,
                    "sl": pos.sl,
                    "tp": pos.tp,
                    "profit": pos.profit,
                    "time_open": open_time_str,
                    "risk_usd": round(risk_usd, 2) if risk_usd is not None else None,
                    "object": pos
                })

        # Detect closed positions
        closed_tickets = set(last_positions.keys()) - set(current_positions.keys())
        for ticket in closed_tickets:
            closed_pos = last_positions[ticket]
            print(f"🔴 CLOSED trade: {closed_pos.symbol} @ {closed_pos.price_open}")

            # Default fallback: current time
            close_time_str = ""

            # Try to get accurate close time from MT5 history using pos time window
            start_time = datetime.fromtimestamp(closed_pos.time) - timedelta(minutes=30)
            end_time = datetime.fromtimestamp(closed_pos.time) + timedelta(hours=12)
            print(f"🔍 Searching deals from {start_time} to {end_time}")

            deals = mt5.history_deals_get(start_time, end_time)
            if deals:
                for d in deals:
                    if d.position_id == closed_pos.ticket and d.entry == mt5.DEAL_ENTRY_OUT:
                        print("found", d)
                        close_time_str = datetime.fromtimestamp(d.time, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
                        break
            else:
                print("⚠️ No deals returned from history_deals_get")

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






        # Update the last seen positions
        last_positions = current_positions.copy()

        time.sleep(1)


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
    return jsonify(all_trades)

@app.route("/api/health", methods=["GET"])
def health_check():
    global last_disconnect_time

    info = mt5.terminal_info()
    mt5_connected = info is not None
    
    # use this if you want auto-reconnect logic
    # if mt5_connected:
    #     # Reset disconnect timer because it's healthy again
    #     last_disconnect_time = None
    # else:
    #     # If this is the first time detecting disconnect, start the timer
    #     if last_disconnect_time is None:
    #         last_disconnect_time = time.time()
    #     # If 10 seconds passed since losing connection → reconnect
    #     if time.time() - last_disconnect_time >= reconnect_delay:
    #         eventlet.spawn_n(reconnect_mt5)
    #         # Prevent multiple scheduled reconnects
    #         last_disconnect_time = time.time()  # reset timer after scheduling

    return jsonify({
        'status': 'healthy' if mt5_connected else 'unhealthy',
        'service': 'MT5_API',
        'mt5_connected': mt5_connected,
        'time_since_disconnect': (
            int(time.time() - last_disconnect_time)
            if last_disconnect_time else 0
        ),
        'reconnect_in_seconds': (
            reconnect_delay - int(time.time() - last_disconnect_time)
            if last_disconnect_time else 0
        ),
        'timestamp': datetime.now().isoformat(),
        'port': 5000
    })


def reconnect_mt5():
    print("⏳ Attempting MT5 reconnect...")
    mt5.shutdown()
    time.sleep(1)
    mt5.initialize()
    print("✅ Reconnect Attempt Done")

@app.route("/api/start-reconnect", methods=["POST"])
def start_reconnect():
    # Start the reconnect timer only when this endpoint is hit
    Timer(10, reconnect_mt5).start()
    return jsonify({"message": "Reconnect countdown started"})

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
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
