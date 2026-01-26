# MyTradingDashboard

*******Installation of trading-dashboard*********
npm install -g @angular/cli
npm install -g nodemon
npm install express
pip install flask flask-cors flask-socketio MetaTrader5 eventlet python-dateutil pandas

*******Installation of NotioProxyApi*********
npm install 
npm install express


*******VScode task - Run task************
shift+space
extension name: Task runner plus


*******Builder.io************
Setup command
npm install --prefix trading-dashboard

Dev command
npm run start --prefix trading-dashboard


*******Builder.io Architecture Overview************
Angular / Builder.io
        ↓
https://mt5-api.jakemt5.host
        ↓
Cloudflare Tunnel
        ↓
Local MT5 API (http://localhost:5000)


1️⃣ Register a Custom Domain
Purchased a domain (jakemt5.host) from Namecheap. Expiry date (Jan 23, 2026 - Jan 24, 2027)
Enabled domain privacy and disabled unnecessary services (hosting, premium DNS).

2️⃣ Connect Domain to Cloudflare
Go to CLoudflare and add the domain you want. (jakemt5.host)
Go to Namecheap nameservers section and update to Cloudflare-provided nameservers [brodie.ns.cloudflare.com,hope.ns.cloudflare.com]
Waited for DNS propagation until Cloudflare status became Active.

3️⃣ Install Cloudflare Tunnel (cloudflared) on Windows
Downloaded and installed cloudflared on Windows.
# winget install --id Cloudflare.cloudflared

4️⃣ Authenticate Cloudflare Tunnel
Authorized Cloudflare account and selected the domain.
# cloudflared tunnel login

5️⃣ Create a Named Tunnel
Generated a tunnel and credentials file (mt5-api.json)
a file will be created in C:\Users\jakejamesmanzon\.cloudflared
# cloudflared tunnel create mt5-api

6️⃣ Map Subdomain to Tunnel
Created a permanent public endpoint:
# cloudflared tunnel route dns mt5-api mt5-api.jakemt5.host

7️⃣ Configure Tunnel Routing
Create configuration yml file in this location -> C:\Users\jakejamesmanzon\.cloudflared\config.yml

tunnel: mt5-api
credentials-file: C:\Users\jakejamesmanzon\.cloudflared\mt5-api.json
ingress:
  - hostname: mt5-api.jakemt5.host
    service: http://localhost:5000
  - service: http_status:404

8️⃣ Run the Tunnel everytime you restart a PC
Local MT5 API became publicly accessible via the custom domain.
# cloudflared tunnel run mt5-api

9️⃣ Verify API Endpoint
Tested via browser or HTTP client:
https://mt5-api.jakemt5.host/api/health

✅ Results:
# Local MT5 API successfully exposed via a permanent HTTPS domain.
# Secure and stable endpoint usable by cloud-based frontends (Angular / Builder.io).
# Eliminated the need for temporary tunnels like ngrok.

ℹ️ Cloudflare Tunnel works like this:
When you run cloudflared tunnel run mt5-api
→ Cloudflare connects to your local API (localhost:5000)
When you close the terminal or restart Windows
→ the tunnel stops ❌