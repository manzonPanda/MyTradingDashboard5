/**
 * AURA AI - Agentic Trading Assistant Backend
 *
 * Architecture:
 *   Angular → AURA Backend → Agent Orchestrator
 *     ├── Memory Retrieval (pgvector + SQL)
 *     ├── Tool Selection (controlled backend tools)
 *     ├── Context Builder (token-budgeted)
 *     ├── Token Manager (Groq free-tier limits)
 *     ├── Groq (LLM reasoning engine)
 *     └── Response Manager (SSE streaming)
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { AuraAgent } from './src/agent.js';
import { TokenManager } from './src/token-manager.js';
import { ToolRouter } from './src/tools.js';
import { MemoryManager } from './src/memory.js';
import { ContextBuilder } from './src/context-builder.js';
import { ConversationManager } from './src/conversation.js';
import { ProactiveEngine } from './src/proactive.js';
import { createLLMProvider, LLMConfigurationError } from './src/ai/provider.js';
import { TradingDataAccess, AccountAccessError } from './src/data/trading-data.js';
import { BehaviorStore } from './src/data/behavior-store.js';
import { AnalysisJobStore } from './src/data/analysis-job-store.js';
import { AnalysisService } from './src/behavior/analysis-service.js';
import { BriefService } from './src/behavior/brief-service.js';
import { AlertsService } from './src/behavior/alerts-service.js';
import { computeScoreDelta, computeWeekView, computePatterns } from './src/behavior/dashboard-stats.js';

dotenv.config();

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  PORT = 5000,
  CORS_ORIGIN = 'http://localhost:4200,http://localhost:4300',
} = process.env;

// Parse CORS origins (support comma-separated list)
const corsOrigins = CORS_ORIGIN.split(',').map(o => o.trim());

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Service-role client — used ONLY on the backend, never exposed to browser
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));

// ─── Auth middleware ───────────────────────────────────────────
// Verifies the Supabase JWT sent from Angular and extracts user_id
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header.' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  req.userId = data.user.id;
  req.accessToken = token;
  next();
}

// ─── Initialize orchestration components ───────────────────────
const tokenManager = new TokenManager();
const memoryManager = new MemoryManager(supabase);
// SECURITY layer: all trade queries are scoped through this module.
const tradingData = new TradingDataAccess(supabase);
const toolRouter = new ToolRouter(supabase, tradingData);
const contextBuilder = new ContextBuilder(tokenManager);
const conversationManager = new ConversationManager(supabase);
const proactiveEngine = new ProactiveEngine(supabase, tradingData);

// LLM provider — selected by AI_PROVIDER env ('groq' default | 'ollama').
const provider = createLLMProvider();

const agent = new AuraAgent({
  tokenManager,
  memoryManager,
  toolRouter,
  contextBuilder,
  conversationManager,
  provider,
});

// ─── Behavior Engine ─────────────────────────────────────────────
// Hybrid architecture: backend computes objective facts, LLM interprets.
const behaviorStore = new BehaviorStore(supabase, tradingData);
const analysisJobs = new AnalysisJobStore(supabase);
const behaviorBriefs = new BriefService(supabase, tradingData);
const behaviorAlerts = new AlertsService(supabase, tradingData);

const analysisService = new AnalysisService({
  supabase,
  provider,
  tradingData,
  logger: console,
});

// ─── Health check ──────────────────────────────────────────────
app.get('/api/aura/health', async (_req, res) => {
  // Provider reachability is reported but does NOT fail the health check:
  // the API service can be healthy while Ollama/Groq is temporarily down.
  let providerHealth = { ok: false, detail: 'not checked' };
  try {
    providerHealth = await provider.checkHealth();
  } catch (err) {
    providerHealth = { ok: false, detail: err?.message || 'provider check failed' };
  }

  res.json({
    status: 'healthy',
    service: 'AURA AI Backend',
    provider: provider.name,
    model: provider.model,
    limits: tokenManager.getLimits(),
    providerHealth,
    timestamp: new Date().toISOString(),
  });
});

// ─── Conversations ─────────────────────────────────────────────
app.get('/api/aura/conversations', authMiddleware, async (req, res) => {
  try {
    const conversations = await conversationManager.listConversations(req.userId);
    res.json(conversations);
  } catch (err) {
    console.error('[AURA] List conversations error:', err);
    res.status(500).json({ error: 'Failed to list conversations.' });
  }
});

app.post('/api/aura/conversations', authMiddleware, async (req, res) => {
  try {
    const { title } = req.body;
    const conversation = await conversationManager.createConversation(req.userId, title);
    res.json(conversation);
  } catch (err) {
    console.error('[AURA] Create conversation error:', err);
    res.status(500).json({ error: 'Failed to create conversation.' });
  }
});

app.delete('/api/aura/conversations/:id', authMiddleware, async (req, res) => {
  try {
    await conversationManager.deleteConversation(req.params.id, req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[AURA] Delete conversation error:', err);
    res.status(500).json({ error: 'Failed to delete conversation.' });
  }
});

app.get('/api/aura/conversations/:id/messages', authMiddleware, async (req, res) => {
  try {
    const messages = await conversationManager.getMessages(req.params.id, req.userId);
    res.json(messages);
  } catch (err) {
    console.error('[AURA] Get messages error:', err);
    res.status(500).json({ error: 'Failed to get messages.' });
  }
});

// ─── Chat (SSE streaming) ──────────────────────────────────────
app.post('/api/aura/chat', authMiddleware, async (req, res) => {
  const { conversationId, message, accountId } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  // SECURITY: the requested account MUST belong to the authenticated JWT
  // user before any query runs. All trade tools scope their queries to this
  // account (or, when absent, to all accounts owned by the user).
  let accountInfo = null;
  if (accountId) {
    try {
      accountInfo = await tradingData.assertAccountOwnership(req.userId, accountId);
    } catch (err) {
      if (err instanceof AccountAccessError) {
        return res.status(403).json({ error: 'The requested trading account does not belong to you.' });
      }
      console.error('[AURA] Account validation error:', err.message);
      return res.status(500).json({ error: 'Failed to validate trading account.' });
    }
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Ensure a conversation exists
    let convId = conversationId;
    if (!convId) {
      const conv = await conversationManager.createConversation(req.userId, message.slice(0, 50));
      convId = conv.id;
      send('conversation_created', { id: convId });
    }

    // Save user message
    try {
      await conversationManager.addMessage(convId, req.userId, 'user', message);
    } catch (err) {
      console.error('[AURA] Failed to save user message:', err.message);
    }

    // Run the agent orchestrator
    const result = await agent.run({
      userId: req.userId,
      conversationId: convId,
      userMessage: message,
      accountId: accountInfo?.id ?? null,
      accountInfo: accountInfo
        ? { name: accountInfo.name, platform: accountInfo.platform, phase: accountInfo.phase }
        : null,
      onToolCall: (tool) => send('tool_call', tool),
      onToolResult: (result) => send('tool_result', result),
      onToken: (token) => send('token', { token }),
      onThinking: (info) => send('thinking', info),
    });

    // Save assistant message
    try {
      await conversationManager.addMessage(
        convId,
        req.userId,
        'assistant',
        result.content,
        { tokenCount: result.totalTokens, toolCalls: result.toolCalls }
      );
    } catch (err) {
      console.error('[AURA] Failed to save assistant message:', err.message);
    }

    // Update conversation title if it's new
    if (!conversationId) {
      try {
        await conversationManager.updateTitleIfDefault(convId, req.userId, message);
      } catch (err) {
        console.error('[AURA] Failed to update title:', err.message);
      }
    }

    send('done', {
      conversationId: convId,
      content: result.content,
      totalTokens: result.totalTokens,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      toolCalls: result.toolCalls,
      memoriesExtracted: result.memoriesExtracted,
      // Internal/debug: the reasoning mode AURA auto-selected for this turn.
      // NOT a user-facing setting — exposed here for observability only.
      reasoningMode: result.reasoningMode,
      reasoningLevel: result.reasoningLevel,
      reasoningReason: result.reasoningReason,
      // ─── Performance metrics ─────────────────────────────
      // Allows before/after latency comparison based on actual usage.
      metrics: result.metrics,
    });
  } catch (err) {
    console.error('[AURA] Chat error:', err);
    send('error', { message: err.message || 'An unexpected error occurred.' });
  } finally {
    res.end();
  }
});

// ─── Memories ──────────────────────────────────────────────────
app.get('/api/aura/memories', authMiddleware, async (req, res) => {
  try {
    const memories = await memoryManager.listMemories(req.userId);
    res.json(memories);
  } catch (err) {
    console.error('[AURA] List memories error:', err);
    res.status(500).json({ error: 'Failed to list memories.' });
  }
}); 

app.post('/api/aura/memories', authMiddleware, async (req, res) => {
  try {
    const { memory, memoryType, importance, source } = req.body;
    if (!memory?.trim()) {
      return res.status(400).json({ error: 'Memory content is required.' });
    }
    const created = await memoryManager.saveMemory(req.userId, {
      memory,
      memoryType: memoryType || 'fact',
      importance: importance || 5,
      source: source || 'manual',
    });
    res.json(created);
  } catch (err) {
    console.error('[AURA] Save memory error:', err);
    res.status(500).json({ error: 'Failed to save memory.' });
  }
});

app.patch('/api/aura/memories/:id', authMiddleware, async (req, res) => {
  try {
    const updated = await memoryManager.updateMemory(req.params.id, req.userId, req.body);
    res.json(updated);
  } catch (err) {
    console.error('[AURA] Update memory error:', err);
    res.status(500).json({ error: 'Failed to update memory.' });
  }
});

app.delete('/api/aura/memories/:id', authMiddleware, async (req, res) => {
  try {
    await memoryManager.deleteMemory(req.params.id, req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[AURA] Delete memory error:', err);
    res.status(500).json({ error: 'Failed to delete memory.' });
  }
});

// ─── Insights ──────────────────────────────────────────────────
app.get('/api/aura/insights', authMiddleware, async (req, res) => {
  try {
    const insights = await proactiveEngine.getInsights(req.userId);
    res.json(insights);
  } catch (err) {
    console.error('[AURA] List insights error:', err);
    res.status(500).json({ error: 'Failed to list insights.' });
  }
});

app.patch('/api/aura/insights/:id/read', authMiddleware, async (req, res) => {
  try {
    await proactiveEngine.markInsightRead(req.params.id, req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[AURA] Mark insight read error:', err);
    res.status(500).json({ error: 'Failed to mark insight as read.' });
  }
});

app.patch('/api/aura/insights/:id/dismiss', authMiddleware, async (req, res) => {
  try {
    await proactiveEngine.dismissInsight(req.params.id, req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('[AURA] Dismiss insight error:', err);
    res.status(500).json({ error: 'Failed to dismiss insight.' });
  }
});

// ─── Proactive check (deterministic, no LLM) ───────────────────
app.post('/api/aura/proactive/check', authMiddleware, async (req, res) => {
  try {
    const events = await proactiveEngine.detectEvents(req.userId);
    res.json({ events });
  } catch (err) {
    console.error('[AURA] Proactive check error:', err);
    res.status(500).json({ error: 'Failed to run proactive check.' });
  }
});

// ─── Trading Behavior Engine API ────────────────────────────────
// All endpoints authenticate via authMiddleware and ownership-check
// accountId through TradingDataAccess. Account isolation is structural.
//
// Design: domain-organized (not table-exposed), all routes prefixed
// /api/behavior-engine/.

/**
 * Helper: validate + resolve accountId for every Behavior Engine route.
 * Throws AccountAccessError (403) if the account doesn't belong to the
 * authenticated user. Returns the resolved account id.
 */
async function requireAccount(req, res, next) {
  const accountId = req.body?.accountId ?? req.query?.accountId ?? req.params?.accountId;
  if (!accountId) return res.status(400).json({ error: 'accountId is required.' });
  try {
    const resolved = await tradingData.assertAccountOwnership(req.userId, accountId);
    req.accountId = resolved.id;
    next();
  } catch (err) {
    if (err instanceof AccountAccessError) {
      return res.status(403).json({ error: err.message });
    }
    console.error('[Behavior] Account validation error:', err.message);
    res.status(500).json({ error: 'Failed to validate trading account.' });
  }
}

// ── Dashboard aggregate (single account-scoped payload for the UI) ──
// Everything the Trading Behavior Engine dashboard renders is computed here
// from real data: trade/reflection counts, engine status, behavior score,
// week-over-week statistics and deterministic patterns. No hardcoded numbers.
app.get('/api/behavior-engine/dashboard', authMiddleware, requireAccount, async (req, res) => {
  try {
    const [tradesRes, behaviors, evidence, analysesRes] = await Promise.all([
      supabase
        .from('trades')
        .select('id, ticket, instrument, pnl, risk_per_trade, time_open, time_close, lots, daily_reflection, created_at')
        .eq('account_id', req.accountId)
        .order('time_open', { ascending: true }),
      behaviorStore.listBehaviors(req.userId, req.accountId, {}),
      behaviorStore.listEvidence(req.userId, req.accountId, { limit: 500 }),
      supabase
        .from('ai_analyses')
        .select('id, status, trigger, model, last_error, created_at, finished_at')
        .eq('account_id', req.accountId)
        .order('created_at', { ascending: false })
        .limit(25),
    ]);
    if (tradesRes.error) throw tradesRes.error;

    const trades = tradesRes.data || [];
    const analyses = analysesRes.error ? [] : (analysesRes.data || []);

    // Evidence counts per behavior (objective occurrence backing).
    const evidenceByBehavior = {};
    for (const ev of evidence) {
      if (!ev.behavior_id) continue;
      evidenceByBehavior[ev.behavior_id] = (evidenceByBehavior[ev.behavior_id] || 0) + 1;
    }

    // Data summary — real counts only.
    const closed = trades.filter((t) => t.time_close);
    const wins = closed.filter((t) => Number(t.pnl) > 0).length;
    const losses = closed.filter((t) => Number(t.pnl) < 0).length;
    const reflectionCount = trades.filter((t) => (t.daily_reflection || '').trim().length > 0).length;
    const firstTradeAt = trades.length ? (trades[0].time_open || trades[0].created_at) : null;
    const lastTradeAt = trades.length ? (trades[trades.length - 1].time_open || trades[trades.length - 1].created_at) : null;
    const lastAnalysis = analyses[0] || null;
    const doneAnalyses = analyses.filter((a) => a.status === 'done').length;

    // Engine status (deterministic, derived — see PHASE 5 of the dashboard spec).
    const hasQueued = analyses.some((a) => a.status === 'queued' || a.status === 'running');
    let engineStatus;
    if (hasQueued) engineStatus = 'analyzing';
    else if (trades.length === 0) engineStatus = 'needs_more_data';
    else if (closed.length < 3 && reflectionCount === 0) engineStatus = 'needs_more_data';
    else if (doneAnalyses === 0) engineStatus = 'analysis_unavailable';
    else if (lastAnalysis && lastAnalysis.status === 'failed') engineStatus = 'analysis_unavailable';
    else engineStatus = 'up_to_date';

    const score = computeScoreDelta(behaviors);
    const week = computeWeekView(trades);
    const patterns = computePatterns(trades);

    // Insights: AI interpretations that were themselves generated FROM the
    // structured evidence (ai_analyses / weekly brief) — never free invention.
    const briefRes = await supabase
      .from('trading_briefs')
      .select('id, week_start, week_end, payload, generated_at')
      .eq('account_id', req.accountId)
      .order('week_start', { ascending: false })
      .limit(1);
    const latestBrief = briefRes.error ? null : (briefRes.data?.[0] || null);

    res.json({
      account_id: req.accountId,
      generated_at: new Date().toISOString(),
      engine_status: engineStatus,
      data_summary: {
        trade_count: trades.length,
        closed_trades: closed.length,
        winning_trades: wins,
        losing_trades: losses,
        reflection_count: reflectionCount,
        first_trade_at: firstTradeAt,
        last_trade_at: lastTradeAt,
        behavior_count: behaviors.length,
        evidence_count: evidence.length,
        analysis_count_done: doneAnalyses,
        analysis_count_total: analyses.length,
        last_analysis_at: lastAnalysis?.finished_at || lastAnalysis?.created_at || null,
        last_analysis_status: lastAnalysis?.status || null,
        last_analysis_error: lastAnalysis?.status === 'failed' ? (lastAnalysis.last_error || null) : null,
      },
      score,
      behaviors: behaviors.map((b) => ({ ...b, evidence_count: evidenceByBehavior[b.id] || 0 })),
      week,
      patterns,
      brief: latestBrief,
    });
  } catch (err) {
    console.error('[Behavior] Dashboard error:', err?.message || err);
    res.status(500).json({ error: 'Failed to build behavior dashboard.' });
  }
});

// ── Behaviors overview ──
app.get('/api/behavior-engine/behaviors', authMiddleware, requireAccount, async (req, res) => {
  try {
    const status = req.query.status || null;
    const { data, error } = await behaviorStore.listBehaviors(req.userId, req.accountId, { status });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Behavior] List behaviors error:', err);
    res.status(500).json({ error: 'Failed to list behaviors.' });
  }
});

// ── Single behavior detail (with evidence) ──
app.get('/api/behavior-engine/behaviors/:id', authMiddleware, requireAccount, async (req, res) => {
  try {
    const behavior = await behaviorStore.getBehavior(req.userId, req.accountId, req.params.id);
    if (!behavior) return res.status(404).json({ error: 'Behavior not found.' });
    res.json(behavior);
  } catch (err) {
    console.error('[Behavior] Get behavior error:', err);
    res.status(500).json({ error: 'Failed to fetch behavior.' });
  }
});

// ── Evidence for a behavior (or all) ──
app.get('/api/behavior-engine/evidence', authMiddleware, requireAccount, async (req, res) => {
  try {
    const { behaviorId, limit = 100, weekStart } = req.query;
    const evidence = await behaviorStore.listEvidence(req.userId, req.accountId, {
      behaviorId: behaviorId || null,
      limit: Number(limit),
      weekStart: weekStart || null,
    });
    res.json(evidence || []);
  } catch (err) {
    console.error('[Behavior] List evidence error:', err);
    res.status(500).json({ error: 'Failed to list evidence.' });
  }
});

// ── Trading rules ──
app.get('/api/behavior-engine/rules', authMiddleware, requireAccount, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('trading_rules')
      .select('*')
      .eq('user_id', req.userId)
      .eq('account_id', req.accountId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Behavior] List rules error:', err);
    res.status(500).json({ error: 'Failed to list trading rules.' });
  }
});

// ── Behavior alerts ──
app.get('/api/behavior-engine/alerts', authMiddleware, requireAccount, async (req, res) => {
  try {
    const { status = 'new', limit = 20 } = req.query;
    const alerts = await behaviorAlerts.listAlerts(req.userId, req.accountId, {
      status, limit: Number(limit),
    });
    res.json(alerts || []);
  } catch (err) {
    console.error('[Behavior] List alerts error:', err);
    res.status(500).json({ error: 'Failed to list alerts.' });
  }
});

// ── Dismiss an alert ──
app.patch('/api/behavior-engine/alerts/:id/dismiss', authMiddleware, requireAccount, async (req, res) => {
  try {
    const alert = await behaviorAlerts.updateStatus(req.userId, req.accountId, req.params.id, 'dismissed');
    res.json(alert);
  } catch (err) {
    console.error('[Behavior] Dismiss alert error:', err);
    res.status(500).json({ error: 'Failed to dismiss alert.' });
  }
});

// ── Weekly trading brief (cached) ──
app.get('/api/behavior-engine/brief', authMiddleware, requireAccount, async (req, res) => {
  try {
    const { weekStart, force = 'false' } = req.query;
    const brief = await behaviorBriefs.getBrief(req.userId, req.accountId, weekStart || null, {
      force: force === 'true',
    });
    res.json(brief);
  } catch (err) {
    console.error('[Behavior] Get brief error:', err);
    res.status(500).json({ error: 'Failed to fetch trading brief.' });
  }
});

// ── Enqueue analysis (manual trigger) ──
app.post('/api/behavior-engine/analyze', authMiddleware, requireAccount, async (req, res) => {
  try {
    const { tradeId, trigger = 'manual' } = req.body;
    const job = await analysisService.enqueue(req.userId, req.accountId, {
      trigger, tradeId: tradeId || null,
    });
    const result = await analysisService.processJob(job);
    res.json(result);
  } catch (err) {
    if (err instanceof AccountAccessError) return res.status(403).json({ error: err.message });
    console.error('[Behavior] Analyze error:', err);
    res.status(500).json({ error: 'Failed to start analysis.' });
  }
});

// ── Trade save webhook: enqueue analysis ──
app.post('/api/behavior-engine/webhook/trade-saved', authMiddleware, async (req, res) => {
  try {
    const { accountId, tradeId } = req.body;
    await tradingData.assertAccountOwnership(req.userId, accountId);
    const job = await analysisService.enqueueForTrade(req.userId, accountId, tradeId);
    analysisService.processNext({ batchSize: 1 }).catch((err) => {
      console.error('[Behavior] Worker error (async):', err?.message || err);
    });
    res.json({ jobId: job.id, status: job.status });
  } catch (err) {
    if (err instanceof AccountAccessError) return res.status(403).json({ error: err.message });
    console.error('[Behavior] Trade-saved webhook error:', err);
    res.status(500).json({ error: 'Failed to enqueue analysis.' });
  }
});

// ── Analysis job status ──
app.get('/api/behavior-engine/analysis/:id', authMiddleware, requireAccount, async (req, res) => {
  try {
    const job = await analysisJobs.getStatus(req.userId, req.accountId, req.params.id);
    if (!job) return res.status(404).json({ error: 'Analysis job not found.' });
    res.json(job);
  } catch (err) {
    console.error('[Behavior] Get analysis status error:', err);
    res.status(500).json({ error: 'Failed to fetch analysis status.' });
  }
});

// ── Backfill: enqueue analysis for historical trades never analyzed ──
// The engine self-heals on startup + periodically (below), but this manual
// trigger lets the frontend/tests drain an account's history immediately.
app.post('/api/behavior-engine/backfill', authMiddleware, requireAccount, async (req, res) => {
  try {
    const result = await analysisService.backfillAccount(req.userId, req.accountId, {
      limit: Number(req.body?.limit || req.query?.limit || 100),
    });
    res.json(result);
  } catch (err) {
    console.error('[Behavior] Backfill error:', err?.message || err);
    res.status(500).json({ error: 'Failed to backfill analysis jobs.' });
  }
});

// ── Worker loop (non-blocking, concurrency-safe) ──
let workerRunning = true;
const WORKER_IDLE_MS = 1000;        // no jobs → quick re-poll
const WORKER_JOB_PACE_MS = 6000;    // after a job → respect provider rate limits
const WORKER_ERROR_BACKOFF_MS = 30_000; // e.g. schema not applied yet → back off

/**
 * Self-healing backfill: enqueue analysis jobs for pre-existing trades that
 * were never analyzed (the engine cannot "see" history that predates the
 * worker). Runs on its OWN interval — never inside the hot claim loop, so a
 * slow backfill cycle can't starve job processing. The service caps enqueues
 * while the queue is deep (pending-threshold) and skips trades that already
 * have a job, so repeated cycles converge instead of flooding.
 */
async function runBackfillCycle() {
  try {
    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('id, user_id');
    if (error || !accounts?.length) return;
    for (const account of accounts) {
      await analysisService.requeueRateLimitFailures(account.user_id, account.id, { limit: 25 });
      await analysisService.backfillAccount(account.user_id, account.id, {
        limit: 10, maxPending: 30,
      });
    }
  } catch (err) {
    // Non-fatal: the worker continues; next cycle retries.
    console.error('[Behavior] Backfill cycle error:', err?.message || err);
  }
}

let lastWorkerError = '';
async function behaviorWorker() {
  if (!workerRunning) return;
  let paceMs = WORKER_IDLE_MS;
  try {
    const result = await analysisService.processNext({ batchSize: 1 });
    // A job was just processed (an LLM call) → pace the next claim so the
    // provider's rate limits are respected; idle → re-poll quickly.
    paceMs = result?.processed > 0 ? WORKER_JOB_PACE_MS : WORKER_IDLE_MS;
    lastWorkerError = '';
  } catch (err) {
    const msg = err?.message || String(err);
    // Graceful degradation: when the Behavior Engine schema hasn't been
    // applied yet (PGRST205), back off instead of spamming every second.
    if (/Could not find the table|PGRST205|schema cache/i.test(msg)) {
      if (lastWorkerError !== msg) {
        console.warn('[Behavior] Schema not applied yet (ai_analyses missing). Worker idling; apply supabase/*.sql to activate.');
      }
      paceMs = WORKER_ERROR_BACKOFF_MS;
    } else {
      console.error('[Behavior] Worker cycle error:', msg);
      paceMs = WORKER_ERROR_BACKOFF_MS;
    }
    lastWorkerError = msg;
  }
  if (workerRunning) setTimeout(behaviorWorker, paceMs);
}
behaviorWorker();

// Independent backfill cadence (60s) — decoupled from job claiming.
let backfillTimer = null;
function startBackfill() {
  if (backfillTimer) return;
  backfillTimer = setInterval(() => { if (workerRunning) void runBackfillCycle(); }, 60_000);
}
startBackfill();

// Graceful shutdown: stop the worker loop before exiting.
function shutdownWorker() {
  workerRunning = false;
  if (backfillTimer) clearInterval(backfillTimer);
}
process.on('SIGINT', shutdownWorker);
process.on('SIGTERM', shutdownWorker);

app.listen(PORT, () => {
  console.log(`✅ AURA AI Backend running at http://localhost:${PORT}`);
  console.log(`   Provider: ${provider.name} | Model: ${provider.model}`);
  console.log(`   Limits: ${JSON.stringify(tokenManager.getLimits())}`);
});