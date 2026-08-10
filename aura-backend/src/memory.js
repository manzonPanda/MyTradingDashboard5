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
   * Save a durable memory with embedding.
   */
  async saveMemory(userId, { memory, memoryType, importance, source, expiresAt }) {
    const embedding = await this.generateEmbedding(memory);

    const { data, error } = await this.supabase
      .from('ai_memories')
      .insert({
        user_id: userId,
        memory,
        memory_type: memoryType,
        importance: importance || 5,
        source: source || 'conversation',
        embedding,
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

    // Regenerate embedding if memory text changed
    if (cleanUpdates.memory) {
      cleanUpdates.embedding = await this.generateEmbedding(cleanUpdates.memory);
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
   * Semantic search of memories using pgvector.
   * Returns the most relevant memories for a query.
   */
  async searchMemories(userId, query, limit = 5) {
    const queryEmbedding = await this.generateEmbedding(query);

    // Use Supabase RPC for vector similarity search
    const { data, error } = await this.supabase.rpc('match_memories', {
      query_embedding: queryEmbedding,
      query_user_id: userId,
      match_count: limit,
    });

    if (error) {
      // Fallback: if the RPC function doesn't exist, use text search
      console.warn('[Memory] Vector search failed, falling back to text search:', error.message);
      return this.textSearchMemories(userId, query, limit);
    }

    return data || [];
  }

  /**
   * Fallback text search (used if pgvector RPC is not set up).
   */
  async textSearchMemories(userId, query, limit = 5) {
    const { data, error } = await this.supabase
      .from('ai_memories')
      .select('id, memory, memory_type, importance, source, created_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .or(`memory.ilike.%${query}%`)
      .order('importance', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Text search memories failed: ${error.message}`);
    return data || [];
  }

  /**
   * Search past conversations semantically.
   */
  async searchConversations(userId, query, limit = 3) {
    const queryEmbedding = await this.generateEmbedding(query);

    const { data, error } = await this.supabase.rpc('match_conversations', {
      query_embedding: queryEmbedding,
      query_user_id: userId,
      match_count: limit,
    });

    if (error) {
      // Fallback: search conversation summaries and titles
      const { data: fallbackData, error: fallbackError } = await this.supabase
        .from('ai_conversations')
        .select('id, title, summary')
        .eq('user_id', userId)
        .or(`title.ilike.%${query}%,summary.ilike.%${query}%`)
        .limit(limit);

      if (fallbackError) throw new Error(`Search conversations failed: ${fallbackError.message}`);
      return fallbackData || [];
    }

    return data || [];
  }

  /**
   * Generate embedding using Supabase's built-in embedding function
   * via the OpenAI-compatible gateway, or a simple hash-based fallback.
   *
   * NOTE: In production, use Supabase's pgvector with the OpenAI
   * embedding model via an edge function or the Supabase AI gateway.
   * For now, we use a deterministic hash-based pseudo-embedding so the
   * system works even without an OpenAI key.
   */
  async generateEmbedding(text) {
    if (!text) return null;

    // Generate a 1536-dimensional pseudo-embedding using a hash-based approach.
    // This is a PLACEHOLDER. Replace with a real embedding model:
    //   const response = await fetch('https://api.openai.com/v1/embeddings', {
    //     method: 'POST',
    //     headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ input: text, model: 'text-embedding-3-small' }),
    //   });
    //   const json = await response.json();
    //   return json.data[0].embedding;

    const dimension = 1536;
    const embedding = new Array(dimension).fill(0);

    // Simple hash-based pseudo-embedding for development
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }

    for (let i = 0; i < dimension; i++) {
      const charCode = text.charCodeAt(i % text.length) || 0;
      const seed = (hash + i * 31 + charCode * 7) % 1000;
      embedding[i] = (seed / 500) - 1; // Normalize to [-1, 1]
    }

    // Normalize the vector
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  /**
   * Extract durable memories from a conversation turn.
   * Uses the LLM to determine if useful information was revealed.
   *
   * Called by the agent after each response.
   */
  async extractMemoriesFromConversation(userId, userMessage, assistantResponse, groqClient) {
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
      const response = await groqClient.chat({
        messages: [
          { role: 'system', content: 'You are a memory extraction system. Respond only in valid JSON.' },
          { role: 'user', content: extractionPrompt },
        ],
        temperature: 0.1,
        maxTokens: 500,
        // Memory extraction is a simple structured task — no reasoning needed.
        reasoningEffort: 'none',
        includeReasoning: false,
      });

      const content = response.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(content.replace(/```json\n?/g, '').replace(/```/g, '').trim());

      const saved = [];
      for (const mem of parsed.memories || []) {
        if (mem.memory && mem.memory_type) {
          const savedMem = await this.saveMemory(userId, {
            memory: mem.memory,
            memoryType: mem.memory_type,
            importance: mem.importance || 5,
            source: 'conversation',
          });
          saved.push(savedMem);
        }
      }

      return saved;
    } catch (err) {
      console.warn('[Memory] Extraction failed:', err.message);
      return [];
    }
  }
}