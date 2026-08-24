// Behavior verification for the drawdown engine.
// Bundle with: npx esbuild drawdown-engine.test.mjs --bundle --format=esm --outfile=drawdown-engine.test.bundle.mjs --alias:@angular/core=./angular-core-stub.mjs && node drawdown-engine.test.bundle.mjs
import { DrawdownService } from './src/app/services/drawdown.service.ts';

const svc = new DrawdownService();

// Spec example: IB $100k · 6% DD · Balance Trailing · Stop at Initial Balance ON
const cfg = { mode: 'balance_trailing', basis: 'balance', stopAtInitialBalance: true, eodTimezone: 'America/New_York' };
const mkPoints = (peak) => [
  { timestamp: 'Start', balance: 100000, equity: 100000 },
  { timestamp: '2026-01-02T15:00:00Z', balance: peak, equity: peak },
];

let pass = 0, fail = 0;
const check = (name, actual, expected, tol = 0.01) => {
  const ok = Math.abs(actual - expected) <= tol;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${actual}, want ${expected}`);
};

// Starting floor $94,000
const s0 = svc.computeState(cfg, { startingBalance: 100000, maxDrawdownPercent: 6, points: mkPoints(100000), currentBalance: 100000, currentEquity: 100000 });
check('start floor', s0.floor, 94000);
console.log(s0.locked === false ? 'PASS' : 'FAIL', 'not locked at start');

// Balance $103,000 → floor $97,000
check('floor @103k', svc.computeState(cfg, { startingBalance: 100000, maxDrawdownPercent: 6, points: mkPoints(103000), currentBalance: 103000, currentEquity: 103000 }).floor, 97000);

// Balance $106,000 → floor $100,000 + LOCKED
const s106 = svc.computeState(cfg, { startingBalance: 100000, maxDrawdownPercent: 6, points: mkPoints(106000), currentBalance: 106000, currentEquity: 106000 });
check('floor @106k (capped)', s106.floor, 100000);
console.log(s106.locked ? 'PASS' : 'FAIL', 'locked @106k');

// Balance $110,000 → floor remains $100,000
check('floor stays @110k', svc.computeState(cfg, { startingBalance: 100000, maxDrawdownPercent: 6, points: mkPoints(110000), currentBalance: 110000, currentEquity: 110000 }).floor, 100000);

// Approaching: floor 94k, equity 95.5k → buffer 1.5k of 6k (25% left) → approaching
const appr = svc.computeState({ ...cfg, stopAtInitialBalance: false }, { startingBalance: 100000, maxDrawdownPercent: 6, points: mkPoints(100000), currentBalance: 95500, currentEquity: 95500 });
console.log(appr.approaching ? 'PASS' : 'FAIL', 'approaching status');

// Breached: equity hits floor
const breach = svc.computeState({ ...cfg, stopAtInitialBalance: false }, { startingBalance: 100000, maxDrawdownPercent: 6, points: mkPoints(100000), currentBalance: 94000, currentEquity: 94000 });
console.log(breach.breached && breach.status === 'breached' ? 'PASS' : 'FAIL', 'breached status');

// EOD trailing with NY timezone: best EOD balance 102k on Jan 2; intraday spike to 105k on Jan 3 must NOT raise floor
const eodCfg = { mode: 'eod_trailing', basis: 'balance', stopAtInitialBalance: false, eodTimezone: 'America/New_York' };
const eodFloor = svc.computeState(eodCfg, {
  startingBalance: 100000, maxDrawdownPercent: 4,
  points: [
    { timestamp: 'Start', balance: 100000, equity: 100000 },
    { timestamp: '2026-01-02T22:00:00Z', balance: 101500, equity: 101500 }, // 5pm NY Jan 2
    { timestamp: '2026-01-03T02:00:00Z', balance: 102000, equity: 102000 }, // EOD Jan 2 NY
    { timestamp: '2026-01-03T14:00:00Z', balance: 105000, equity: 105000 }, // intraday Jan 3 (unrealized for EOD)
    { timestamp: '2026-01-03T20:00:00Z', balance: 100800, equity: 100800 }, // EOD Jan 3 NY
  ],
  currentBalance: 100800, currentEquity: 100800,
}).floor;
// best EOD = 102,000 → floor = 98,000 (not 101,000 from the 105k intraday spike)
check('EOD floor ignores intraday spike', eodFloor, 98000);

// Intraday trailing resets outside session window
const intraCfg = { mode: 'intraday_trailing', basis: 'balance', stopAtInitialBalance: false, eodTimezone: 'UTC' };
const intra = svc.computeState(intraCfg, {
  startingBalance: 100000, maxDrawdownPercent: 5,
  points: [
    { timestamp: 'Start', balance: 100000, equity: 100000 },
    { timestamp: '2026-01-02T10:00:00Z', balance: 104000, equity: 104000 },
    { timestamp: '2026-01-05T11:00:00Z', balance: 101000, equity: 101000 },
  ],
  currentBalance: 101000, currentEquity: 101000,
  sessionStartTimestamp: '2026-01-05T00:00:00Z',
});
check('intraday floor only counts session', intra.floor, 96000);

// Fixed mode
const fixed = svc.computeState({ mode: 'fixed', basis: 'balance', stopAtInitialBalance: true, eodTimezone: 'UTC' }, { startingBalance: 2500, maxDrawdownPercent: 10, points: [{ timestamp: 'Start', balance: 2500, equity: 2500 }], currentBalance: 2500, currentEquity: 2500 });
check('fixed floor 10% of 2500', fixed.floor, 2250);
check('fixed DD amount', fixed.maxDrawdownAmount, 250);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
