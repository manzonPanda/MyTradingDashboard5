from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO
import MetaTrader5 as mt5
import threading
import time
import eventlet
from datetime import datetime, timedelta
from collections import defaultdict
import pandas as pd

eventlet.monkey_patch()  # <- important for eventlet

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")  # Allow WebSocket connections

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
            socketio.emit('price_update', {
                "ticket": pos.ticket,
                "symbol": pos.symbol,
                "volume": pos.volume,
                "type": pos.type,
                "price_open": pos.price_open,
                "price_current": pos.price_current,
                "profit": pos.profit,
                "time": pos.time
            })

        # Detect new open positions
        for ticket, pos in current_positions.items():
            if ticket not in seen_tickets:
                seen_tickets.add(ticket)
                print(f"🟢 New OPEN trade: {pos.symbol} @ {pos.price_open}")
                socketio.emit('trade_opened', {
                    "ticket": pos.ticket,
                    "symbol": pos.symbol,
                    "volume": pos.volume,
                    "type": pos.type,
                    "price_open": pos.price_open,
                    "sl": pos.sl,
                    "tp": pos.tp,
                    "profit": pos.profit,
                    "time_open": datetime.fromtimestamp(pos.time).strftime('%Y-%m-%d %H:%M:%S'),
                    "object":pos
                })

        # Detect closed positions
        closed_tickets = set(last_positions.keys()) - set(current_positions.keys())
        for ticket in closed_tickets:
            closed_pos = last_positions[ticket]
            print(f"🔴 CLOSED trade: {closed_pos.symbol} @ {closed_pos.price_open}")
            socketio.emit('trade_closed', {
                "ticket": closed_pos.ticket,
                "symbol": closed_pos.symbol,
                "volume": closed_pos.volume,
                "type": closed_pos.type,
                "price_open": closed_pos.price_open,
                "price_close": closed_pos.price_current,
                "profit": closed_pos.profit,
                "time_close": int(time.time()),
                "object":closed_pos
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

# from datetime import datetime

@app.route("/api/history", methods=["GET"])
def full_history():
    from_date = datetime(2000, 1, 1)
    to_date = datetime.now()

    deals = mt5.history_deals_get(from_date, to_date)
    if deals is None or len(deals) == 0:
        return jsonify({"error": "No closed trades (deals) found"}), 404

    # Convert all deals to DataFrame
    df_deals = pd.DataFrame([d._asdict() for d in deals])
    df_deals['time'] = pd.to_datetime(df_deals['time'], unit='s')

    # Separate different types of deals
    df_entry = df_deals[df_deals['entry'] == mt5.DEAL_ENTRY_IN][['position_id', 'time','price']]
    df_entry = df_entry.rename(columns={'time': 'time_open', 'price': 'entry_price'})

    df_exit = df_deals[df_deals['entry'] == mt5.DEAL_ENTRY_OUT].copy()
    df_exit = df_exit.rename(columns={'time': 'time_close'})

    # Merge to get time_open and time_close
    df_merged = pd.merge(df_exit, df_entry, on='position_id', how='left')
    # Rename exit price for clarity
    df_merged = df_merged.rename(columns={'price': 'exit_price'})

    # Fix commissions: sum all commissions for the same position_id
    df_commission = df_deals[df_deals['commission'] != 0].groupby('position_id')['commission'].sum().reset_index()
    df_merged = df_merged.merge(df_commission, on='position_id', how='left', suffixes=('', '_total'))

    # Use the total commission
    df_merged['commission'] = df_merged['commission_total'].fillna(0)
    df_merged.drop(columns=['commission_total'], inplace=True)

    # Merge with orders for SL/TP/Comment if available
    orders = mt5.history_orders_get(from_date, to_date)
    if orders and len(orders) > 0:
        df_orders = pd.DataFrame([o._asdict() for o in orders])
        df_orders = df_orders[['ticket', 'sl', 'tp', 'comment']]
        df_merged = df_merged.merge(df_orders, left_on='order', right_on='ticket', how='left', suffixes=('', '_order'))

    # Convert datetime columns to string to prevent NaT issues
    df_merged['time_open'] = df_merged['time_open'].astype(str)
    df_merged['time_close'] = df_merged['time_close'].astype(str)

    # Final output fields
    result = df_merged[[
        'ticket', 'position_id', 'order', 'symbol', 'volume', 'entry_price', 'exit_price', 'profit',  
    'commission', 'sl', 'tp', 'comment', 'time_open', 'time_close' 
    ]].to_dict(orient='records')

    return jsonify(result)



if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
