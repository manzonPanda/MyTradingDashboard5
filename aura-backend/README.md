# AURA AI — Agentic Trading Assistant

AURA AIis a personal agentic trading assistant built into the MyTradingDashboard. It provides a ChatGPT-like conversational experience while becoming progressively more personalized and proactive.

## Architecture

```
Angular
   │
   │ HTTP / SSE
   ▼
AURA Backend (this folder)
   │
   ├── Conversation Manager   (episodic memory)
   ├── Memory Manager          (pgvector semantic memory)
   ├── Agent / Tool Router    (controlled backend tools)
   ├── Token Limiter           (Groq free-tier optimization)
   ├── Context Builder         (token-budgeted context assembly)
   └── Proactive Event Engine  (deterministic event detection)
   │
   ├───────────────┬────────────────┐
   ▼               ▼                ▼
Supabase        pgvector          Groq
Structured DB   Semantic Memory   LLM
```

## Quick Start

### 1. Install dependencies

```bash
cd aura-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — your Supabase service role key (from Settings → API)
- `GROQ_API_KEY` — your Groq API key (from https://console.groq.com)

### 3. Run the backend

```bash
npm start
```

The server runs at `http://localhost:5000`.

### 4. Run the Angular frontend

```bash
cd ../trading-dashboard
npm start
```

Navigate to `http://localhost:4300/aura-ai` to access the AURA AI chat.

---

## Supabase Configuration Steps

You need to run several SQL scripts in your Supabase project's SQL Editor. Go to:

> **Supabase Dashboard → your project → SQL Editor → New query**

### Step 1: Enable pgvector extension

```sql
create extension if not exists vector;
```

### Step 2: Create AI tables

Run each of these SQL files in order (found in the `supabase/` folder):

1. **`table_ai_conversations.sql`** — stores conversation history
2. **`table_ai_messages.sql`** — stores individual messages
3. **`table_ai_memories.sql`** — stores semantic long-term memories with embeddings
3. **`table_ai_insights.sql`** — stores AI-generated insights and proactive alerts

### Step 3: Enable Row Level Security

Run **`aura_ai_rls.sql`** to enable RLS on all AI tables. This ensures users can only access their own data.

### Step 4: Create vector search functions

Run **`aura_ai_vector_functions.sql`** to create the `match_memories` and `match_conversations` RPC functions for semantic search.

### Step 5: Verify

Check that all tables appear in:
> **Supabase Dashboard → Table Editor**

You should see: `ai_conversations`, `ai_messages`, `ai_memories`, `ai_insights`

---

## Groq Configuration

1. Go to [https://console.groq.com](https://console.groq.com)
2. Create an account or sign in
3. Go to **API Keys** → Create new key
4. Copy the key into your `.env` file as `GROQ_API_KEY`

### Free-tier limits (default model: `qwen/qwen3.6-27b`)
- 30 requests per minute (RPM)
- 1,000 requests per day (RPD)
- 8,000 tokens per minute (TPM)
- 200,000 tokens per day (TPD)
- The Token Manager automatically enforces these limits

### Automatic reasoning
AURA selects reasoning mode automatically based on the question — the user
never toggles reasoning on/off. A deterministic router (no extra LLM call)
classifies each message:

| Level | Example | `reasoning_effort` |
|---|---|---|
| `SIMPLE` | "What was my last trade?" | `none` (reasoning OFF) |
| `ANALYSIS` | "How did I perform this week?" | `default` (reasoning ON) |
| `DEEP_ANALYSIS` | "Analyze why my DAX performance deteriorated over 3 months vs my rules & journal." | `default` (reasoning ON) |

Reasoning is OFF by default (saves TPM). If a "simple" question turns out to
need multiple tools / data sources, the agent escalates reasoning ON at runtime.
The selected mode is emitted as a `thinking` event and in the `done` event
(`reasoningMode` / `reasoningLevel` / `reasoningReason`) for debugging — it is
NOT a user-facing setting.

### Changing the model
Edit `.env`:
```
GROQ_MODEL=qwen/qwen3.6-27b
```
Model limits + reasoning support are looked up from the `MODEL_REGISTRY` in
`src/model-config.js` — the single source of truth shared by the Groq client,
token manager, and agent. Add a new model there to make it available.

---

## Memory Architecture

AURA implements four distinct memory layers:

### 1. Working Memory
The current conversation context. Only relevant recent messages are sent to Groq.

### 2. Episodic Conversation Memory
Conversations and messages stored in Supabase (`ai_conversations`, `ai_messages`). Older conversations are summarized rather than continuously included.

### 3. Semantic Long-term Memory
Uses Supabase pgvector (`ai_memories` table). Each memory has an embedding for semantic retrieval.

**Memory types:** `preference`, `trading_rule`, `behavior`, `goal`, `fact`, `strategy`, `conversation`, `insight`

### 4. Memory Extraction
AURA does NOT automatically save every message as permanent memory. After each conversation turn, the LLM determines whether useful durable information was revealed.

### Memory Lifecycle
Users can:
- View memories (via the Memory panel in the UI)
- Edit memories
- Delete memories
- Disable/re-enable memories
- Memories support `expires_at` for temporary information

---

## Retrieval Methods

AURA uses the correct retrieval method for each type of information:

| Question Type | Retrieval Method | Example |
|---|---|---|
| Trading data (P&L, win rate) | SQL via backend tools | `get_performance_summary()` |
| Semantic info (preferences, rules) | pgvector | `search_memories(query)` |
| Past discussions | pgvector / text search | `search_conversations(query)` |

**AURA never dumps the entire database into the LLM.**

---

## Trading Data Tools

All tools are READ-ONLY and verify `user_id`:

| Tool | Description |
|---|---|
| `get_recent_trades` | Recent trades with optional symbol filter |
| `get_open_trades` | Currently open positions |
| `get_trade` | Specific trade by ticket |
| `get_performance_summary` | Overall P&L, win rate, profit factor, R-multiple |
| `get_strategy_statistics` | Stats grouped by strategy |
| `get_risk_metrics` | Max drawdown, avg risk, R-multiples |
| `get_session_statistics` | Stats by trading session |
| `get_symbol_statistics` | Stats for a specific instrument |
| `get_trading_rules` | User's trading rules and settings |
| `get_journal_entries` | Trade journal reflections |
| `get_roi_summary` | ROI/payout summary |
| `search_memories` | Semantic memory search |
| `save_memory` | Save a durable memory |

---

## Safety

AURA is initially **READ-ONLY** regarding trading accounts. It will never:
- Place trades
- Modify orders
- Close trades
- Withdraw funds
- Change account settings

All sensitive operations occur on the backend. `SUPABASE_SERVICE_ROLE_KEY` and `GROQ_API_KEY` are never exposed to the browser.

---

## Proactive Engine

AURA uses deterministic event detection (no LLM) to identify significant events:

- Daily target reached
- Daily loss limit approaching
- Consecutive losses (3+)
- Overtrading detected (10+ trades/day)
- Large drawdown
- Repeated rule violations
- Weekly review available

Only after an event is detected does AURA optionally use Groq to generate a natural-language notification.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/aura/health` | Health check |
| GET | `/api/aura/conversations` | List conversations |
| POST | `/api/aura/conversations` | Create conversation |
| DELETE | `/api/aura/conversations/:id` | Delete conversation |
| GET | `/api/aura/conversations/:id/messages` | Get messages |
| POST | `/api/aura/chat` | Send message (SSE streaming) |
| GET | `/api/aura/memories` | List memories |
| POST | `/api/aura/memories` | Save memory |
| PATCH | `/api/aura/memories/:id` | Update memory |
| DELETE | `/api/aura/memories/:id` | Delete memory |
| GET | `/api/aura/insights` | List insights |
| PATCH | `/api/aura/insights/:id/read` | Mark insight read |
| PATCH | `/api/aura/insights/:id/dismiss` | Dismiss insight |
| POST | `/api/aura/proactive/check` | Run proactive check |

All endpoints (except `/health`) require a `Bearer` JWT token from Supabase Auth.