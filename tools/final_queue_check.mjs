import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// 1. Global job counts
for (const st of ['done', 'failed', 'queued', 'running', 'skipped']) {
  const { count } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', st);
  console.log(`${st}=${count}`);
}

// 2. Distinct trades with a DONE analysis + duplicate evidence check
const { data: done } = await supabase.from('ai_analyses').select('trade_id, account_id').eq('status', 'done');
const doneTrades = new Set(done.map(j => j.trade_id));
console.log('done_jobs=' + done.length, 'distinct_trades_analyzed=' + doneTrades.size);

const { data: evAll } = await supabase.from('behavior_evidence').select('behavior_id, trade_id, account_id');
const seen = new Set(); let dupEv = 0;
for (const e of evAll) { const k = e.behavior_id + '|' + e.trade_id; if (seen.has(k)) dupEv++; seen.add(k); }
console.log('evidence_total=' + evAll.length, 'duplicate_behavior_trade_pairs=' + dupEv);

// 3. Behaviors total
const { count: behCount } = await supabase.from('behaviors').select('id', { count: 'exact', head: true });
console.log('behaviors_total=' + behCount);

// 4. Rate-limit recovery: trades whose FIRST attempts failed (rate limit) but eventually have a DONE job
const { data: failedRL } = await supabase.from('ai_analyses').select('trade_id, last_error').eq('status', 'failed').like('last_error', '%Rate limit%');
const rlTrades = new Set(failedRL.map(j => j.trade_id));
const recovered = [...rlTrades].filter(t => doneTrades.has(t));
console.log('rate_limit_failed_trades=' + rlTrades.size, 'later_succeeded=' + recovered.length);

// 5. Still-queued jobs (drain status)
const { count: queuedNow } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('status', 'queued');
const { data: newest } = await supabase.from('ai_analyses').select('created_at').eq('status', 'queued').order('created_at', { ascending: false }).limit(1);
console.log('queued_now=' + queuedNow, 'newest_queued_job=' + (newest?.[0]?.created_at || 'none'));

// 6. Main account drain state
const ACCT = '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1';
const { count: mainQueued } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('account_id', ACCT).eq('status', 'queued');
const { count: mainDone } = await supabase.from('ai_analyses').select('id', { count: 'exact', head: true }).eq('account_id', ACCT).eq('status', 'done');
console.log('main_account: done=' + mainDone, 'queued=' + mainQueued);
