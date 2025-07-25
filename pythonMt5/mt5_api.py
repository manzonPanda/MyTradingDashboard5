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
                    "time": pos.time,
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
                "time": int(time.time()),
                "object":closed_pos
            })

        # Update the last seen positions
        last_positions = current_positions.copy()

        time.sleep(5)



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
    from_date = datetime(2000, 1, 1)  # Start date
    to_date = datetime.now()          # End date

    deals = mt5.history_deals_get(from_date, to_date)
    if deals is None:
        print("No deals found")
    else:
        df_deals = pd.DataFrame(list(deals), columns=deals[0]._asdict().keys())
        print(df_deals)

    orders = mt5.history_orders_get(from_date, to_date)
    if orders is None:
        print("No orders found")
    else:
        df_orders = pd.DataFrame(list(orders), columns=orders[0]._asdict().keys())
        print(df_orders)

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
