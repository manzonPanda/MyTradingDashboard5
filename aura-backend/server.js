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

// ── Worker loop (non-blocking, concurrency-safe) ──
let workerRunning = true;
let workerBackoffMs = 1000;
const WORKER_ERROR_BACKOFF_MS = 30_000; // e.g. schema not applied yet → back off
async function behaviorWorker() {
  if (!workerRunning) return;
  try {
    await analysisService.processNext({ batchSize: 1 });
    workerBackoffMs = 1000; // healthy cycle → normal cadence
  } catch (err) {
    const msg = err?.message || String(err);
    // Graceful degradation: when the Behavior Engine schema hasn't been
    // applied yet (PGRST205), back off instead of spamming every second.
    if (/Could not find the table|PGRST205|schema cache/i.test(msg)) {
      if (workerBackoffMs < WORKER_ERROR_BACKOFF_MS) {
        console.warn('[Behavior] Schema not applied yet (ai_analyses missing). Worker idling; apply supabase/*.sql to activate.');
      }
      workerBackoffMs = WORKER_ERROR_BACKOFF_MS;
    } else {
      console.error('[Behavior] Worker cycle error:', msg);
      workerBackoffMs = WORKER_ERROR_BACKOFF_MS;
    }
  }
  if (workerRunning) setTimeout(behaviorWorker, workerBackoffMs);
}
behaviorWorker();

// Graceful shutdown: stop the worker loop before exiting.
function shutdownWorker() {
  workerRunning = false;
}
process.on('SIGINT', shutdownWorker);
process.on('SIGTERM', shutdownWorker);

app.listen(PORT, () => {
  console.log(`✅ AURA AI Backend running at http://localhost:${PORT}`);
  console.log(`   Provider: ${provider.name} | Model: ${provider.model}`);
  console.log(`   Limits: ${JSON.stringify(tokenManager.getLimits())}`);
});