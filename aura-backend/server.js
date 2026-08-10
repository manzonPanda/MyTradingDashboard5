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
const toolRouter = new ToolRouter(supabase);
const contextBuilder = new ContextBuilder(tokenManager);
const conversationManager = new ConversationManager(supabase);
const proactiveEngine = new ProactiveEngine(supabase);

const agent = new AuraAgent({
  tokenManager,
  memoryManager,
  toolRouter,
  contextBuilder,
  conversationManager,
});

// ─── Health check ──────────────────────────────────────────────
app.get('/api/aura/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'AURA AI Backend',
    model: tokenManager.getModel(),
    limits: tokenManager.getLimits(),
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
  const { conversationId, message } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
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

app.listen(PORT, () => {
  console.log(`✅ AURA AI Backend running at http://localhost:${PORT}`);
  console.log(`   Model: ${tokenManager.getModel()}`);
  console.log(`   Limits: ${JSON.stringify(tokenManager.getLimits())}`);
});