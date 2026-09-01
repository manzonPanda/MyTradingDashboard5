#!/usr/bin/env node
/**
 * Dashboard payload verification — replicates the exact computation of
 * GET /api/behavior-engine/dashboard for a given account (default: the
 * user's selected account) using the same dashboard-stats module the
 * endpoint imports. Read-only; prints the payload the frontend receives.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'aura-backend', 'package.json'));
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', 'aura-backend', '.env') });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { computeScoreDelta, computeWeekView, computePatterns } = await import(
  pathToFileURL(path.join(__dirname, '..', 'aura-backend', 'src', 'behavior', 'dashboard-stats.js')).href
);

const ACCT = process.argv[2] || '0c5a7c00-0d30-4ae0-a02a-b7e5730e05d1';

const [tradesRes, behaviorsRes, evRes, anRes, accRes] = await Promise.all([
  supabase.from('trades').select('id,ticket,instrument,pnl,risk_per_trade,time_open,time_close,lots,daily_reflection,created_at').eq('account_id', ACCT).order('time_open'),
  supabase.from('behaviors').select('*').eq('account_id', ACCT),
  supabase.from('behavior_evidence').select('*').eq('account_id', ACCT),
  supabase.from('ai_analyses').select('status,created_at,finished_at').eq('account_id', ACCT).order('created_at', { ascending: false }).limit(25),
  supabase.from('accounts').select('name').eq('id', ACCT).single(),
]);

const trades = tradesRes.data || [];
const behaviors = behaviorsRes.data || [];
const evByB = {};
for (const e of evRes.data || []) evByB[e.behavior_id] = (evByB[e.behavior_id] || 0) + 1;

const closed = trades.filter((t) => t.time_close);
const hasQueued = (anRes.data || []).some((a) => a.status === 'queued' || a.status === 'running');
const doneAnalyses = (anRes.data || []).filter((a) => a.status === 'done').length;
const engineStatus = hasQueued ? 'analyzing'
  : trades.length === 0 ? 'needs_more_data'
  : doneAnalyses === 0 ? 'analysis_unavailable'
  : 'up_to_date';

const payload = {
  account: accRes.data?.name,
  engine_status: engineStatus,
  data_summary: {
    trade_count: trades.length,
    reflection_count: trades.filter((t) => (t.daily_reflection || '').trim()).length,
    winning: closed.filter((t) => t.pnl > 0).length,
    losing: closed.filter((t) => t.pnl < 0).length,
    behavior_count: behaviors.length,
    evidence_count: (evRes.data || []).length,
    analysis_done: doneAnalyses,
  },
  score: computeScoreDelta(behaviors),
  behaviors: behaviors.map((b) => ({
    name: b.name, type: b.behavior_type, status: b.status,
    occurrences: b.occurrence_count, confidence: b.confidence,
    estimated_impact_pnl: b.estimated_impact_pnl, evidence: evByB[b.id] || 0,
  })),
  patterns: computePatterns(trades).map((p) => ({ id: p.id, title: p.title, occurrences: p.occurrences, direction: p.direction })),
  week: (() => { const w = computeWeekView(trades); return { this_week: w.current.trade_count, previous: w.previous.trade_count, delay_cur: w.current.avg_entry_delay_min, delay_prev: w.previous.avg_entry_delay_min }; })(),
};

fs.writeFileSync(path.join(__dirname, 'dashboard_payload.txt'), JSON.stringify(payload, null, 1), 'utf8');
console.log('written tools/dashboard_payload.txt');
