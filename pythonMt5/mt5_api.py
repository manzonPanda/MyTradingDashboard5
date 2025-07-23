from flask import Flask, jsonify
from flask_cors import CORS
import MetaTrader5 as mt5

app = Flask(__name__)
CORS(app)

# Initialize connection to MetaTrader 5
if not mt5.initialize():
    raise Exception(f"MT5 Initialization failed: {mt5.last_error()}")

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
            "time": p.time
        })
    return jsonify(results)

@app.route("/api/history", methods=["GET"])
def get_history():
    from datetime import datetime, timedelta
    now = datetime.now()
    past = now - timedelta(days=30)
    history = mt5.history_deals_get(past, now)
    if history is None:
        return jsonify({"error": "Failed to get history"}), 500

    results = []
    for h in history:
        results.append({
            "ticket": h.ticket,
            "symbol": h.symbol,
            "volume": h.volume,
            "type": h.type,
            "price": h.price,
            "profit": h.profit,
            "time": h.time
        })
    return jsonify(results)

if __name__ == "__main__":
    app.run(port=5000)
