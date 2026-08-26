/**
 * Zero-dependency static file server for the compiled Angular bundle.
 *
 * Serves:  dist/trading-dashboard/browser  on http://localhost:8080
 * Used by the Cloudflare Tunnel ingress rule that publishes
 * https://dashboard.jakemt5.host — no Firebase / external host involved.
 *
 * Start:  node serve-dashboard.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.join(__dirname, 'dist', 'trading-dashboard', 'browser');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {           // block path traversal
      res.writeHead(403); res.end(); return;
    }

    let stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    if (stat && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    }
    if (!stat) {
      // SPA fallback — unknown routes render the app shell.
      filePath = path.join(ROOT, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Hashed assets are immutable; never cache the HTML shell so new
      // deploys are picked up immediately.
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=604800'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('serve-dashboard error:', err);
    res.writeHead(500);
    res.end('Internal server error');
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard served at http://localhost:${PORT} from ${ROOT}`);
});
