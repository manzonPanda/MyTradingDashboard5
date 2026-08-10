/**
 * AURA Agent - Main orchestrator
 *
 * The backend is the brain's orchestration layer.
 * Groq is the reasoning engine, not the entire agent.
 *
 * Flow:
 *   1. Receive user message
 *   2. Classify intent
 *   3. Retrieve relevant context (conversation summary, recent messages, memories)
 *   4. Build token-budgeted context
 *   5. Call Groq with tools
 *   6. If tool calls → execute tools → feed results back → repeat
 *   7. Stream final response
 *   8. Extract durable memories from the conversation
 *
 * Token budgeting:
 *   - Before every Groq call, calculate safe max_output = TPM_LIMIT - inputTokens
 *   - If the output budget is too small, compress the context (don't increase max_tokens)
 *   - For reasoning models, detect reasoning-only/empty-content responses and
 *     retry with compressed context
 *
 * Enforces:
 *   - MAX_TOOL_CALLS_PER_REQUEST
 *   - MAX_AGENT_ITERATIONS
 *   - input + max_output NEVER exceeds TPM_LIMIT
 */

import { GroqClient, GroqRateLimitError } from './groq-client.js';
import { classifyReasoning, shouldEscalateReasoning } from './reasoning-router.js';
import {
  isReasoningEnabled as isReasoningOn,
  getOutputBudgetForLevel,
  REASONING_LEVEL,
} from './model-config.js';
import { compactToolResult } from './context-builder.js';

// Adaptive recent-message limits by complexity level.
// SIMPLE questions don't need 20 messages of history — 4 is enough for context.
// DEEP_ANALYSIS benefits from more conversation context.
const MESSAGE_LIMIT_BY_LEVEL = {
  SIMPLE: 4,
  ANALYSIS: 8,
  DEEP_ANALYSIS: 20,
};

// Coalesce tiny reasoning deltas into periodic SSE events.
// Without this, reasoning models (gpt-oss-120b) stream ~1 word per SSE
// event, causing dozens of network writes and client re-renders.
function makeReasoningBuffer(onThinking, { intervalMs = 1000, maxLen = 200 } = {}) {
  let buf = '';
  let timer = null;
  const flush = () => {
    timer = null;
    if (buf.trim()) {
      onThinking?.({ message: `Reasoning: ${buf.slice(0, maxLen)}` });
      buf = '';
    }
  };
  return {
    onReasoning: (r) => {
      buf += r;
      if (timer === null) timer = setTimeout(flush, intervalMs);
    },
    flushNow: () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (buf.trim()) {
        onThinking?.({ message: `Reasoning: ${buf.slice(0, maxLen)}` });
        buf = '';
      }
    },
  };
}

export class AuraAgent {
  constructor({ tokenManager, memoryManager, toolRouter, contextBuilder, conversationManager }) {
    this.tokenManager = tokenManager;
    this.memoryManager = memoryManager;
    this.toolRouter = toolRouter;
    this.contextBuilder = contextBuilder;
    this.conversationManager = conversationManager;
    this.groq = new GroqClient();
  }

  async run({ userId, conversationId, userMessage, onToolCall, onToolResult, onToken, onThinking, onReasoning }) {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const allToolCalls = [];
    let iteration = 0;

    // 1. Classify intent
    const intent = this.contextBuilder.classifyIntent(userMessage);
    onThinking?.({ intent, message: `Classified as: ${intent}` });

    // 1b. Determine reasoning mode — AUTOMATIC, deterministic (NO extra LLM call).
    // The user never picks reasoning; AURA decides based on the question.
    let reasoning = classifyReasoning(userMessage, intent);
    onThinking?.({
      reasoning_mode: reasoning.reasoningEffort,
      reason: reasoning.reason,
      message: `Reasoning: ${reasoning.level} (effort "${reasoning.reasoningEffort}") — ${reasoning.reason}`,
    });
    // reasoningEnabled: does THIS request actually use reasoning on the active model?
    let reasoningEnabled = isReasoningOn(reasoning.reasoningEffort);

    // 1c. Adaptive output budget — caps max_tokens per request so we don't
    // over-reserve output headroom (and TPM) for simple lookups. The model can
    // still produce full, helpful responses within these caps:
    //   SIMPLE ≈ 600, ANALYSIS ≈ 1000, DEEP_ANALYSIS ≈ 1400.
    // When reasoning is enabled, the token manager multiplies this by the
    // reasoning budget multiplier (reasoning tokens need extra room).
    let outputBudgetCap = getOutputBudgetForLevel(reasoning.level);

    // 1d. Adaptive message limit — fewer history messages for simple questions.
    const messageLimit = MESSAGE_LIMIT_BY_LEVEL[reasoning.level] ?? MESSAGE_LIMIT_BY_LEVEL.SIMPLE;

    // ─── Metrics ──────────────────────────────────────────────
    const metrics = {
      latencyMs: 0,
      modelLatencyMs: 0,
      toolLatencyMs: 0,
      iterations: 0,
      rateLimited: false,
      retryDelayMs: 0,
    };
    const runStartTime = Date.now();

    // 2. Retrieve relevant context
    // NOTE: We do NOT send the entire conversation, trade history, memories, or journal.
    // We send: conversation summary + last few messages + only relevant memories.
    // The message limit is adaptive — SIMPLE questions get fewer history messages.
    const [recentMessages, conversationSummary, relevantMemories] = await Promise.all([
      this.conversationManager.getRecentMessages(conversationId, userId, messageLimit),
      this.conversationManager.getConversationSummary(conversationId, userId),
      this.retrieveRelevantMemories(userId, userMessage, intent),
    ]);

    // 3. Build system prompt
    const systemPrompt = this.contextBuilder.buildSystemPrompt();

    // 4. Get tool definitions — FILTERED by intent + complexity level to
    // reduce input tokens. For a simple "what was my last trade?" we send only
    // ~5 tools (~200 tokens) instead of all 13 (~1050 tokens). Memory tools are
    // always included. ANALYSIS/DEEP_ANALYSIS get the full intent-mapped set.
    const suggestedTools = this.contextBuilder.getOptimalTools(intent, reasoning.level);
    const toolDefs = this.toolRouter.getFilteredToolDefinitions(suggestedTools);

    // 5. Build initial context
    let toolResults = [];
    let messages = this.contextBuilder.buildContext({
      systemPrompt,
      conversationSummary,
      recentMessages,
      relevantMemories,
      toolResults,
    });

    // 6. Agent loop (tool calling)
    let response = null;
    // Rate-limit retries must NOT consume an agent iteration. Without this,
    // a 429 on the final iteration exits the loop with response === null and
    // the user gets the generic "unable to generate a response" fallback.
    let rateLimitRetries = 0;
    const MAX_RATE_LIMIT_RETRIES = 3;
    while (iteration < this.tokenManager.maxIterations) {
      iteration++;
      onThinking?.({ iteration, message: `Agent iteration ${iteration}` });

      // ─── Token budget calculation ──────────────────────────
      // Calculate the safe max_output for this specific request using the
      // ADAPTIVE output budget cap (600 for SIMPLE, 1400 for DEEP_ANALYSIS).
      // This ensures input + max_output NEVER exceeds the TPM limit, and
      // simple lookups don't over-reserve output headroom.
      const budget = this.tokenManager.calculateMaxOutputTokens(
        messages,
        reasoningEnabled,
        outputBudgetCap
      );

      if (budget.isTooSmall) {
        // The output budget is too small — compress the context aggressively
        onThinking?.({
          message: `Context too large (${budget.inputTokens} input tokens), compressing...`,
        });
        // Target: leave room for at least 500 output tokens
        const targetInput = this.tokenManager.tpmLimit - 500;
        messages = this.tokenManager.compressForTpmLimit(messages, targetInput);
        // Recalculate after compression
        const newBudget = this.tokenManager.calculateMaxOutputTokens(
          messages,
          reasoningEnabled,
          outputBudgetCap
        );
        budget.inputTokens = newBudget.inputTokens;
        budget.maxOutput = newBudget.maxOutput;
        budget.tpmCeiling = newBudget.tpmCeiling;
        onThinking?.({
          message: `Compressed to ${newBudget.inputTokens} input tokens, ${newBudget.maxOutput} output budget`,
        });
      }

      onThinking?.({
        message: `Token budget: ${budget.inputTokens} input, ${budget.maxOutput} output (TPM ceiling: ${budget.tpmCeiling})`,
      });

      // Acquire rate limit slot — pass the actual output budget so the TPM
      // safety margin reflects this request, not the config default (1500).
      await this.tokenManager.acquireRequest(budget.maxOutput);

      let skipTools = false;
      // Hoisted to loop scope so the catch block below can read it (a `const`
      // inside try is block-scoped and would throw "modelStart is not defined"
      // when a Groq call fails inside the catch).
      let modelStart = Date.now();
      try {
        // Use streaming for the final response, non-streaming for tool-calling iterations
        const isFinalIteration = iteration === this.tokenManager.maxIterations;
        modelStart = Date.now();

        if (isFinalIteration || skipTools) {
          // Final iteration: stream the response (no tools to force text output).
          // Only wire up reasoning streaming when reasoning is ON for this turn.
          // When reasoning is OFF (effort "none"), the model emits no reasoning
          // deltas, so onReasoning never fires — no reasoning SSE events.
          const rb = reasoningEnabled ? makeReasoningBuffer(onThinking) : null;
          response = await this.groq.chatStream({
            messages,
            tools: null,
            temperature: 0.7,
            maxTokens: budget.maxOutput,
            onToken,
            onReasoning: rb ? rb.onReasoning : null,
            reasoningEffort: reasoning.reasoningEffort,
            includeReasoning: reasoningEnabled,
          });
          if (rb) rb.flushNow();

          // ─── Reasoning-enabled: empty content handling ──────
          // If reasoning was ON and the content is empty, the reasoning phase
          // consumed the output budget. We do NOT increase max_tokens. Instead,
          // we compress the context and retry with the same (or smaller) output
          // budget, giving the model less to reason about. (Only relevant when
          // reasoning is actually enabled.)
          if ((!response.content || response.content.trim().length === 0) && reasoningEnabled) {
            onThinking?.({
              message: 'Reasoning consumed the output budget. Compressing context and retrying...',
            });

            // Compress context aggressively to reduce reasoning load
            const retryTarget = Math.floor(this.tokenManager.tpmLimit * 0.5); // use only 50% of TPM
            const compressedMessages = this.tokenManager.compressForTpmLimit(messages, retryTarget);
            const retryBudget = this.tokenManager.calculateMaxOutputTokens(
              compressedMessages,
              reasoningEnabled,
              outputBudgetCap
            );

            await this.tokenManager.acquireRequest(retryBudget.maxOutput);
            try {
              const rbRetry = reasoningEnabled ? makeReasoningBuffer(onThinking) : null;
              const retry = await this.groq.chatStream({
                messages: compressedMessages,
                tools: null,
                temperature: 0.5,
                maxTokens: retryBudget.maxOutput,
                onToken,
                onReasoning: rbRetry ? rbRetry.onReasoning : null,
                reasoningEffort: reasoning.reasoningEffort,
                includeReasoning: reasoningEnabled,
              });
              if (rbRetry) rbRetry.flushNow();
              this.tokenManager.releaseRequest(this.tokenManager.estimateTokens(retry.content || ''));

              if (retry.content && retry.content.trim().length > 0) {
                response = retry;
              } else {
                // Still empty — return a graceful fallback
                response = {
                  content: 'I apologize, but I was unable to generate a response with the current context. Please try rephrasing your question or starting a new conversation.',
                  toolCalls: null,
                };
              }
            } catch (retryErr) {
              this.tokenManager.releaseRequest(0);
              throw retryErr;
            }
          }
        } else {
          // Non-final iteration: use non-streaming to check for tool calls.
          // Tool-calling iterations use the same reasoning mode as the turn.
          // For simple lookups reasoning is OFF → cheaper/faster tool decisions.
          response = await this.groq.chat({
            messages,
            tools: toolDefs,
            temperature: 0.7,
            maxTokens: budget.maxOutput,
            reasoningEffort: reasoning.reasoningEffort,
            includeReasoning: reasoningEnabled,
          });

          const choice = response.choices?.[0];
          const message = choice?.message;

          if (!message) break;

          // If no tool calls, we're done
          if (!message.tool_calls || message.tool_calls.length === 0) {
            // Stream the content we already have
            if (message.content) {
              onToken?.(message.content);
            }
            response = { content: message.content || '', toolCalls: null };
            break;
          }

          // Handle tool calls
          response = {
            content: message.content || '',
            toolCalls: message.tool_calls,
          };
        }
      } catch (err) {
        this.tokenManager.releaseRequest();
        metrics.modelLatencyMs += Date.now() - modelStart;

        if (err instanceof GroqRateLimitError) {
          // A 429 is a transient transport error, not a reasoning step.
          // Decrement iteration so the retry repeats the SAME iteration
          // instead of burning the next one (which would exit the loop on
          // the final iteration and yield the "unable to generate a
          // response" fallback with outputTokens: 0).
          rateLimitRetries++;
          metrics.rateLimited = true;
          metrics.retryDelayMs += err.retryAfter * 1000;
          if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
            onThinking?.({
              message: `Rate limit retries exhausted (${MAX_RATE_LIMIT_RETRIES}), stopping.`,
            });
            break;
          }
          onThinking?.({
            message: `Rate limited, waiting ${err.retryAfter}s... (retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`,
          });
          await this.tokenManager.sleep(err.retryAfter * 1000);
          iteration--; // retry the same iteration, don't consume a new one
          continue;
        }

        // If tool calling fails, retry without tools
        if (err.message && err.message.includes('Failed to call a function')) {
          onThinking?.({ message: 'Tool calling failed, generating response without tools...' });
          skipTools = true;
          // Retry this iteration without tools
          try {
            const rbFallback = reasoningEnabled ? makeReasoningBuffer(onThinking) : null;
            response = await this.groq.chatStream({
              messages,
              tools: null,
              temperature: 0.7,
              maxTokens: budget.maxOutput,
              onToken,
              onReasoning: rbFallback ? rbFallback.onReasoning : null,
              reasoningEffort: reasoning.reasoningEffort,
              includeReasoning: reasoningEnabled,
            });
            if (rbFallback) rbFallback.flushNow();
          } catch (retryErr) {
            throw retryErr;
          }
        } else {
          throw err;
        }
      }

      metrics.modelLatencyMs += Date.now() - modelStart;

      const inputTokens = this.tokenManager.estimateMessagesTokens(messages);
      const outputTokens = this.tokenManager.estimateTokens(response.content || '');
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      this.tokenManager.releaseRequest(inputTokens + outputTokens);

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      // Check tool call limit
      if (allToolCalls.length >= this.tokenManager.maxToolCalls) {
        onThinking?.({ message: 'Max tool calls reached, generating final response.' });
        // Force a final response without tools
        messages.push({
          role: 'assistant',
          content: response.content || 'Let me compile the information I\'ve gathered.',
          tool_calls: response.toolCalls,
        });

        // Calculate budget for the final response
        const finalBudget = this.tokenManager.calculateMaxOutputTokens(
          messages,
          reasoningEnabled,
          outputBudgetCap
        );
        if (finalBudget.isTooSmall) {
          const targetInput = this.tokenManager.tpmLimit - 500;
          messages = this.tokenManager.compressForTpmLimit(messages, targetInput);
        }

        await this.tokenManager.acquireRequest(finalBudget.maxOutput);
        const finalModelStart = Date.now();
        const rbMax = reasoningEnabled ? makeReasoningBuffer(onThinking) : null;
        const finalResponse = await this.groq.chatStream({
          messages,
          tools: null,
          temperature: 0.7,
          maxTokens: finalBudget.maxOutput,
          onToken,
          onReasoning: rbMax ? rbMax.onReasoning : null,
          reasoningEffort: reasoning.reasoningEffort,
          includeReasoning: reasoningEnabled,
        });
        if (rbMax) rbMax.flushNow();
        metrics.modelLatencyMs += Date.now() - finalModelStart;
        this.tokenManager.releaseRequest(this.tokenManager.estimateTokens(finalResponse.content));
        response = finalResponse;
        break;
      }

      // Handle tool calls
      const toolStart = Date.now();
      const toolResult = await this.handleToolCalls(
        response.toolCalls,
        userId,
        onToolCall,
        onToolResult
      );
      metrics.toolLatencyMs += Date.now() - toolStart;
      allToolCalls.push(...toolResult);

      // Add assistant message with tool calls to context
      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls,
      });

      // Add tool results to context — COMPACTED to strip null/empty fields.
      // This is the single biggest input-token saver: a 10-trade result with
      // many null fields drops from ~600 to ~250 tokens.
      for (const tr of toolResult) {
        messages.push({
          role: 'tool',
          content: JSON.stringify(compactToolResult(tr.result)),
          name: tr.toolName,
          tool_call_id: tr.toolCallId,
        });
      }

      // ─── Adaptive reasoning escalation ────────────────────
      // If a question we classified as SIMPLE turned out to need multiple tools
      // or multiple data sources (memory + journal + trades), escalate reasoning
      // ON for the final answer — it materially improves synthesis.
      if (!reasoningEnabled) {
        const usedMemory = allToolCalls.some((tc) => tc.toolName === 'search_memories');
        const usedJournal = allToolCalls.some((tc) => tc.toolName === 'get_journal_entries');
        if (
          shouldEscalateReasoning({
            level: reasoning.level,
            toolCallsCount: allToolCalls.length,
            usedMemory,
            usedJournal,
          })
        ) {
          reasoning = {
            level: 'ANALYSIS',
            reasoningEffort: REASONING_LEVEL.DEFAULT,
            reason: `Escalated to reasoning — ${allToolCalls.length} tools across multiple data sources`,
          };
          reasoningEnabled = true;
          // Update the output budget cap to match the escalated level
          outputBudgetCap = getOutputBudgetForLevel(reasoning.level);
          onThinking?.({
            reasoning_mode: reasoning.reasoningEffort,
            reason: reasoning.reason,
            message: `Reasoning escalated to ${reasoning.level} (effort "${reasoning.reasoningEffort}")`,
          });
        }
      }

      // Rebuild context with token budget — pass the adaptive output cap so
      // simple requests get more input headroom.
      messages = this.tokenManager.truncateMessages(messages, outputBudgetCap);
    }

    metrics.iterations = iteration;
    metrics.latencyMs = Date.now() - runStartTime;

    const finalContent = response?.content || 'I apologize, but I was unable to generate a response. Please try again.';

    // 7. Extract durable memories (async, non-blocking)
    let memoriesExtracted = 0;
    try {
      const extracted = await this.memoryManager.extractMemoriesFromConversation(
        userId,
        userMessage,
        finalContent,
        this.groq
      );
      memoriesExtracted = extracted.length;
    } catch (err) {
      console.warn('[Agent] Memory extraction failed:', err.message);
    }

    // 8. Check if conversation needs compression
    try {
      const messageCount = await this.conversationManager.countMessages(conversationId, userId);
      if (this.conversationManager.shouldCompress(messageCount)) {
        onThinking?.({ message: 'Compressing conversation history...' });
        await this.compressConversation(conversationId, userId, recentMessages);
      }
    } catch (err) {
      console.warn('[Agent] Compression check failed:', err.message);
    }

    return {
      content: finalContent,
      totalTokens: totalInputTokens + totalOutputTokens,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      toolCalls: allToolCalls,
      memoriesExtracted,
      // Internal/debug: the reasoning mode AURA chose for this turn (not a
      // user-facing setting). Surfaced in the SSE "done" event for observability.
      reasoningMode: reasoning.reasoningEffort,
      reasoningLevel: reasoning.level,
      reasoningReason: reasoning.reason,
      // ─── Performance metrics (requirement #10) ───────────
      // Allows before/after comparison without guessing.
      metrics: {
        latencyMs: metrics.latencyMs,
        modelLatencyMs: metrics.modelLatencyMs,
        toolLatencyMs: metrics.toolLatencyMs,
        iterations: metrics.iterations,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        reasoningMode: reasoning.reasoningEffort,
        rateLimited: metrics.rateLimited,
        retryDelayMs: metrics.retryDelayMs,
      },
    };
  }

  /**
   * Retrieve relevant memories based on the user's message and intent.
   * Uses pgvector for semantic search — does NOT send all memories.
   */
  async retrieveRelevantMemories(userId, userMessage, intent) {
    try {
      // For memory and analysis intents, search semantically
      if (intent === 'memory' || intent === 'analysis' || intent === 'action') {
        return await this.memoryManager.searchMemories(userId, userMessage, 5);
      }

      // For trading data questions, get high-importance memories only
      if (intent === 'trading_data') {
        const { data, error } = await this.memoryManager.supabase
          .from('ai_memories')
          .select('memory, memory_type, importance')
          .eq('user_id', userId)
          .eq('is_active', true)
          .gte('importance', 7)
          .order('importance', { ascending: false })
          .limit(3);

        if (error) return [];
        return data || [];
      }

      return [];
    } catch (err) {
      console.warn('[Agent] Memory retrieval failed:', err.message);
      return [];
    }
  }

  /**
   * Handle tool calls from the LLM.
   */
  async handleToolCalls(toolCalls, userId, onToolCall, onToolResult) {
    const results = [];

    for (const tc of toolCalls) {
      const toolName = tc.function?.name;
      let args = {};

      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        args = {};
      }

      onToolCall?.({ name: toolName, args });

      const result = await this.toolRouter.executeTool(toolName, args, userId, this.memoryManager);

      onToolResult?.({ name: toolName, result });

      results.push({
        toolName,
        toolCallId: tc.id,
        args,
        result,
      });
    }

    return results;
  }

  /**
   * Compress conversation by generating a summary.
   * Uses a small output budget to stay within TPM limits.
   */
  async compressConversation(conversationId, userId, recentMessages) {
    try {
      // Get the existing summary
      const existingSummary = await this.conversationManager.getConversationSummary(conversationId, userId);

      // Build a summary prompt
      const messagesText = recentMessages
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      const summaryPrompt = existingSummary
        ? `Update the conversation summary with the following recent messages.\n\nExisting summary: ${existingSummary}\n\nRecent messages:\n${messagesText}\n\nProvide a concise updated summary (max 200 words).`
        : `Summarize the following conversation in a concise way (max 200 words). Focus on key topics, decisions, and insights discussed.\n\n${messagesText}`;

      const summaryMessages = [
        { role: 'system', content: 'You are a conversation summarizer. Be concise.' },
        { role: 'user', content: summaryPrompt },
      ];

      // Calculate safe output budget for compression
      const budget = this.tokenManager.calculateMaxOutputTokens(summaryMessages);

      await this.tokenManager.acquireRequest();
      const response = await this.groq.chat({
        messages: summaryMessages,
        temperature: 0.3,
        maxTokens: Math.min(300, budget.maxOutput),
      });
      this.tokenManager.releaseRequest(300);

      const summary = response.choices?.[0]?.message?.content;
      if (summary) {
        await this.conversationManager.updateSummary(conversationId, userId, summary);
      }
    } catch (err) {
      console.warn('[Agent] Conversation compression failed:', err.message);
    }
  }
}