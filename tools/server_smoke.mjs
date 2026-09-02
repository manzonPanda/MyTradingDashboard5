// Smoke test: boot the real server, hit /api/aura/health + dashboard (unauthenticated should 401), then shut down.
import { spawn } from 'node:child_process';
const serverPath = 'c:/Users/jakejamesmanzon/Downloads/MyTradingDashboard2/aura-backend/server.js';
const child = spawn('node.exe', [serverPath], {
  cwd: 'c:/Users/jakejamesmanzon/Downloads/MyTradingDashboard2/aura-backend',
  env: { ...process.env, PORT: '5099' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); });
child.stderr.on('data', (d) => { out += d.toString(); });
async function waitFor(tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (/listening|PORT|running at/i.test(out) || /EADDRINUSE|Error:|error:/i.test(out)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}
await waitFor();
const port = '5099';
let health = 'no-response';
try {
  const r = await fetch(`http://localhost:${port}/api/aura/health`);
  health = `${r.status}`;
} catch (e) { health = `fetch-error:${e.message}`; }
let dashUnauth = 'no-response';
try {
  const r = await fetch(`http://localhost:${port}/api/behavior-engine/dashboard`);
  dashUnauth = `${r.status}`;
} catch (e) { dashUnauth = `fetch-error:${e.message}`; }
console.log('BOOT_OUTPUT_TAIL:', out.slice(-700));
console.log('HEALTH:', health);
console.log('DASHBOARD_UNAUTH:', dashUnauth);
child.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 500));
try { child.kill('SIGKILL'); } catch {}
process.exit(0);