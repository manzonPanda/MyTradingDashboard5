/**
 * Memory Manager - Semantic long-term memory
 *
 * Uses Supabase pgvector for semantic memory storage and retrieval.
 * Implements memory extraction, lifecycle management, and search.
 *
 * IMPORTANT: Uses the correct retrieval method for each type:
 *   - Structured data → SQL (handled by ToolRouter)
 *   - Semantic information → pgvector (handled here)
 */

import dotenv from 'dotenv';

dotenv.config();

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

export class MemoryManager {
  constructor(supabase) {
    this.supabase = supabase;
  }

  /**
   * Save a durable memory. Embeddings are no longer generated (the previous
   * hash-based pseudo-embedding was removed — see searchMemories).
   */
  async saveMemory(userId, { memory, memoryType, importance, source, expiresAt }) {
    const { data, error } = await this.supabase
      .from('ai_memories')
      .insert({
        user_id: userId,
        memory,
        memory_type: memoryType,
        importance: importance || 5,
        source: source || 'conversation',
        expires_at: expiresAt || null,
      })
      .select('id, memory, memory_type, importance, source, is_active, expires_at, created_at')
      .single();

    if (error) throw new Error(`Save memory failed: ${error.message}`);
    return data;
  }

  /**
   * List all active memories for a user.
   */
  async listMemories(userId) {
    const { data, error } = await this.supabase
      .from('ai_memories')
      .select('id, memory, memory_type, importance, source, is_active, expires_at, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`List memories failed: ${error.message}`);
    return data || [];
  }

  /**
   * Update a memory (lifecycle management).
   */
  async updateMemory(memoryId, userId, updates) {
    const allowedFields = ['memory', 'memory_type', 'importance', 'is_active', 'expires_at'];

    const cleanUpdates = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        cleanUpdates[field] = updates[field];
      }
    }

    const { data, error } = await this.supabase
      .from('ai_memories')
      .update(cleanUpdates)
      .eq('id', memoryId)
      .eq('user_id', userId)
      .select('id, memory, memory_type, importance, is_active, expires_at, updated_at')
      .single();

    if (error) throw new Error(`Update memory failed: ${error.message}`);
    return data;
  }

  /**
   * Delete a memory permanently.
   */
  async deleteMemory(memoryId, userId) {
    const { error } = await this.supabase
      .from('ai_memories')
      .delete()
      .eq('id', memoryId)
      .eq('user_id', userId);

    if (error) throw new Error(`Delete memory failed: ${error.message}`);
  }

  /**
   * Search memories using structured SQL retrieval with recency weighting.
   *
   * NOTE: the previous implementation generated hash-based pseudo-embeddings
   * ("semantic" search that was not actually semantic). Embeddings have been
   * REMOVED. Retrieval is now deterministic SQL: term match, then importance,
   * then recency. A real embedding backend can be reintroduced later behind
   * this same method without touching callers.
   */
  async searchMemories(userId, query, limit = 5) {
    const terms = this.extractSearchTerms(query);
    if (terms.length === 0) {
      // No usable terms — return the most important recent memories instead.
      return this.listTopMemories(userId, limit);
    }

    const filter = terms
      .map((term) => `memory.ilike.%${term}%`)
      .join(',');

    const { data, error } = await this.supabase
      .from('ai_memories')
      .select('id, memory, memory_type, importance, source, created_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .or(filter)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Search memories failed: ${error.message}`);

    const results = data || [];
    if (results.length === 0) {
      // Recency-weighted fallback so the model always has useful context.
      return this.listTopMemories(userId, limit);
    }
    return results;
  }

  /** Extract safe LIKE terms from a query (escapes %, _, commas). */
  extractSearchTerms(query) {
    if (!query) return [];
    return query
      .toLowerCase()
      .split(/[\s,.;:!?()"'`]+/)
      .map((term) => term.replace(/[%_,]/g, '').trim())
      .filter((term) => term.length >= 3)
      .slice(0, 4);
  }

  /** Most important, most recent active memories (recency-weighted fallback). */
  async listTopMemories(userId, limit = 5) {
    const { data, error } = await this.supabase
      .from('ai_memories')
      .select('id, memory, memory_type, importance, source, created_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`List memories failed: ${error.message}`);
    return data || [];
  }

  /**
   * Search past conversations (title/summary text match).
   * The pgvector match_conversations() RPC has been retired from the code
   * path — it referenced an embedding column that does not exist.
   */
  async searchConversations(userId, query, limit = 3) {
    const term = this.extractSearchTerms(query)[0];
    if (!term) return [];

    const { data, error } = await this.supabase
      .from('ai_conversations')
      .select('id, title, summary, updated_at')
      .eq('user_id', userId)
      .or(`title.ilike.%${term}%,summary.ilike.%${term}%`)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Search conversations failed: ${error.message}`);
    return data || [];
  }

  /**
   * Extract durable memories from a conversation turn.
   * Uses the LLM to determine if useful information was revealed.
   *
   * Called by the agent after each response. The LLM provider is injected
   * (any provider — Ollama, Groq, future). Output is validated before insert
   * so a malformed LLM response can never corrupt memory rows.
   */
  async extractMemoriesFromConversation(userId, userMessage, assistantResponse, llmProvider) {
    const extractionPrompt = `Analyze this conversation turn and determine if any durable, long-term useful information was revealed that should be remembered.

User said: "${userMessage}"

Assistant responded: "${assistantResponse}"

Extract memories ONLY if:
1. The user stated a clear preference, rule, goal, or strategy
2. The user revealed a behavioral pattern
3. The user shared a fact about their trading approach
4. The information is durable (not casual/temporary)

Do NOT extract:
- Casual statements
- Temporary context
- Questions
- Greetings

Respond in JSON format:
{
  "memories": [
    {
      "memory": "concise statement of the fact/preference",
      "memory_type": "preference|trading_rule|behavior|goal|fact|strategy",
      "importance": 1-10,
      "source": "conversation"
    }
  ]
}

If no durable information was revealed, return: {"memories": []}`;

    try {
      const response = await llmProvider.chat({
        messages: [
          { role: 'system', content: 'You are a memory extraction system. Respond only in valid JSON.' },
          { role: 'user', content: extractionPrompt },
        ],
        temperature: 0.1,
        maxTokens: 500,
        json: true,
        // Memory extraction is a simple structured task — no reasoning needed.
        reasoningEffort: 'none',
        includeReasoning: false,
      });

      const content = response.content || '{}';
      const cleaned = content.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const candidates = Array.isArray(parsed?.memories) ? parsed.memories : [];

      // VALIDATION: only well-formed memories with a whitelisted type are
      // persisted — a malformed LLM response can never corrupt memory rows.
      const allowedTypes = new Set([
        'preference', 'trading_rule', 'behavior', 'goal', 'fact', 'strategy', 'conversation', 'insight',
      ]);
      const clampImportance = (value) =>
        Math.max(1, Math.min(10, Number.isFinite(Number(value)) ? Number(value) : 5));

      const saved = [];
      for (const mem of candidates) {
        const text = typeof mem?.memory === 'string' ? mem.memory.trim() : '';
        const type = typeof mem?.memory_type === 'string' ? mem.memory_type.trim() : '';
        if (!text || !allowedTypes.has(type)) continue;
        if (text.length > 500) continue; // guard against runaway output

        const savedMem = await this.saveMemory(userId, {
          memory: text,
          memoryType: type,
          importance: clampImportance(mem.importance),
          source: 'conversation',
        });
        saved.push(savedMem);
      }

      return saved;
    } catch (err) {
      console.warn('[Memory] Extraction failed:', err.message);
      return [];
    }
  }
}