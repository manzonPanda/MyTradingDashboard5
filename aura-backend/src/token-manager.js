/**
 * Token Manager - Groq free-tier optimization
 *
 * Enforces rate limits and token budgets to stay within Groq's free-tier
 * constraints.
 *
 * Key principle: NEVER allow input + max_output to exceed the model's TPM limit.
 * Before every Groq call, the agent asks this manager to calculate the safe
 * max_output given the current input size.
 *
 * Model-specific budgets now live in model-config.js (the SINGLE SOURCE OF
 * TRUTH). This module only consumes that config + adds rate-limit/TPM machinery.
 * The old local MODEL_REGISTRY + its own GROQ_MODEL default have been removed to
 * eliminate the groq-client/token-manager model mismatch.
 */

import dotenv from 'dotenv';
import { getActiveModelConfig, isReasoningEnabled, REASONING_LEVEL } from './model-config.js';

dotenv.config();

const {
  MAX_CONCURRENT_REQUESTS = 2,
  MAX_TOOL_CALLS_PER_REQUEST = 5,
  MAX_AGENT_ITERATIONS = 3,
} = process.env;


export class TokenManager {
  constructor() {
    // Single source of truth: model id, limits, and reasoning config all come
    // from model-config.js. This guarantees the token manager and the Groq
    // client agree on which model is active.
    const cfg = getActiveModelConfig();
    this.model = cfg.model;
    this.maxInputTokens = cfg.maxInputTokens;
    this.maxOutputTokens = cfg.maxOutputTokens;
    this.tpmLimit = cfg.tpmLimit;
    this.tpdLimit = cfg.tpdLimit;
    this.maxConcurrent = parseInt(MAX_CONCURRENT_REQUESTS, 10);
    this.maxToolCalls = parseInt(MAX_TOOL_CALLS_PER_REQUEST, 10);
    this.maxIterations = parseInt(MAX_AGENT_ITERATIONS, 10);

    // Whether the ACTIVE model supports reasoning at all (capability).
    // Note: reasoning being SUPPORTED ≠ reasoning being ON for a given call.
    // Per-call reasoning is decided by the reasoning-router + agent, and
    // calculateMaxOutputTokens() takes an explicit reasoningEnabled flag so the
    // output budget reflects THIS request's reasoning mode.
    this.modelSupportsReasoning = cfg.isReasoning;
    this.reasoningBudgetMultiplier = cfg.reasoningBudgetMultiplier;

    // Simple sliding-window rate limiter
    this.requestTimestamps = [];
    this.tokenUsage = []; // { timestamp, tokens }
    this.dailyTokenUsage = []; // { timestamp, tokens } for TPD tracking
    this.activeRequests = 0;
  }

  getModel() {
    return this.model;
  }

  /**
   * Does the ACTIVE model support reasoning tokens at all? (capability, not
   * whether reasoning is turned on for a specific call.)
   */
  isReasoningModel() {
    return this.modelSupportsReasoning;
  }

  getLimits() {
    return {
      model: this.model,
      maxInputTokens: this.maxInputTokens,
      maxOutputTokens: this.maxOutputTokens,
      tpmLimit: this.tpmLimit,
      tpdLimit: this.tpdLimit,
      maxConcurrent: this.maxConcurrent,
      maxToolCalls: this.maxToolCalls,
      maxIterations: this.maxIterations,
      modelSupportsReasoning: this.modelSupportsReasoning,
    };
  }

  /**
   * Rough token estimate: ~4 chars per token for English text.
   * This is a heuristic; actual tokenization differs.
   */
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Count tokens in a messages array (rough estimate).
   */
  estimateMessagesTokens(messages) {
    let total = 0;
    for (const msg of messages) {
      total += this.estimateTokens(msg.content || '');
      // Overhead per message (role, formatting)
      total += 4;
    }
    return total;
  }

  /**
   * Calculate the safe max_output for a given set of messages.
   *
   * Formula: max_output = clamp(tpmCeiling - inputTokens, minOutput, outputBudgetCap)
   *
   * `outputBudgetCap` is the ADAPTIVE per-request cap (e.g. 600 for SIMPLE,
   * 1400 for DEEP_ANALYSIS). This replaces the old fixed `this.maxOutputTokens`
   * so simple lookups don't over-reserve output headroom — which was a major
   * contributor to hitting the 8K TPM ceiling and triggering 429s.
   *
   * When `reasoningEnabled`, the cap is multiplied by `reasoningBudgetMultiplier`
   * (reasoning tokens count toward max_tokens but aren't visible output).
   *
   * Either way we clamp to the TPM limit, so input + max_output NEVER exceeds it.
   */
  calculateMaxOutputTokens(messages, reasoningEnabled = false, outputBudgetCap = null) {
    const inputTokens = this.estimateMessagesTokens(messages);
    const minOutput = 200; // absolute floor — below this, context must be compressed

    // Use the provided adaptive cap, falling back to the config default
    let baseOutput = outputBudgetCap ?? this.maxOutputTokens;

    // Reasoning-enabled calls need more output room (reasoning + content)
    if (reasoningEnabled) {
      baseOutput = Math.floor(baseOutput * this.reasoningBudgetMultiplier);
    }

    // The hard ceiling: TPM limit minus input tokens
    const tpmCeiling = this.tpmLimit - inputTokens;

    // Clamp: never below minOutput, never above baseOutput, never above tpmCeiling
    const maxOutput = Math.max(minOutput, Math.min(baseOutput, tpmCeiling));

    return {
      inputTokens,
      maxOutput,
      tpmCeiling,
      isTooSmall: tpmCeiling < minOutput,
      needsCompression: tpmCeiling < baseOutput,
    };
  }

  /**
   * Check if we can make a request right now.
   * Uses a bounded loop instead of recursion to avoid infinite waiting.
   * Max wait is 30 seconds — after that, it proceeds anyway.
   *
   * @param {number} outputBudget - The per-request output cap (e.g. 600 for
   *   SIMPLE). Used as the TPM safety margin so we don't over-reserve headroom
   *   for simple requests. Falls back to this.maxOutputTokens if not provided.
   */
  async acquireRequest(outputBudget = null) {
    const safetyMargin = outputBudget ?? this.maxOutputTokens;
    const startedAt = Date.now();
    const maxWaitMs = 30_000;

    while (true) {
      const now = Date.now();
      const oneMinuteAgo = now - 60_000;

      // Clean old timestamps
      this.requestTimestamps = this.requestTimestamps.filter((t) => t > oneMinuteAgo);
      this.tokenUsage = this.tokenUsage.filter((u) => u.timestamp > oneMinuteAgo);

      // Check concurrent requests
      if (this.activeRequests < this.maxConcurrent) {
        // Check RPM (30 per minute on free tier, but we use a safe margin)
        if (this.requestTimestamps.length < 28) {
          // Check TPM — leave headroom for this request's output budget
          const recentTokens = this.tokenUsage.reduce((sum, u) => sum + u.tokens, 0);
          if (recentTokens < this.tpmLimit - safetyMargin) {
            this.activeRequests++;
            this.requestTimestamps.push(now);
            return;
          }
        }
      }

      // If we've waited too long, proceed anyway (better than hanging forever)
      if (Date.now() - startedAt > maxWaitMs) {
        console.warn('[TokenManager] Max wait exceeded, proceeding anyway.');
        this.activeRequests = Math.min(this.maxConcurrent, this.activeRequests + 1);
        this.requestTimestamps.push(Date.now());
        return;
      }

      await this.sleep(2000);
    }
  }

  releaseRequest(tokensUsed = 0) {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    if (tokensUsed > 0) {
      this.tokenUsage.push({ timestamp: Date.now(), tokens: tokensUsed });
    }
  }

  /**
   * Truncate messages to fit within the token budget.
   * Keeps the system prompt + most recent messages.
   *
   * The output budget is subtracted from the input budget so that
   * input + output never exceeds maxInputTokens. Pass the actual per-request
   * output cap so simple requests get more input headroom.
   */
  truncateMessages(messages, reservedOutputTokens = null) {
    const outputBudget = reservedOutputTokens ?? this.maxOutputTokens;
    const inputBudget = this.maxInputTokens - outputBudget;

    if (messages.length === 0) return [];

    // Always keep the system prompt (first message if role=system)
    const systemMessages = [];
    const conversationMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg);
      } else {
        conversationMessages.push(msg);
      }
    }

    const systemTokens = this.estimateMessagesTokens(systemMessages);
    const remainingBudget = inputBudget - systemTokens;

    if (remainingBudget <= 0) {
      // System prompt alone exceeds budget — truncate it
      return [{
        role: 'system',
        content: systemMessages[0]?.content?.slice(0, inputBudget * 4) || '',
      }];
    }

    // Keep most recent messages that fit
    const kept = [];
    let usedTokens = 0;

    for (let i = conversationMessages.length - 1; i >= 0; i--) {
      const msg = conversationMessages[i];
      const msgTokens = this.estimateTokens(msg.content) + 4;

      if (usedTokens + msgTokens > remainingBudget) break;

      kept.unshift(msg);
      usedTokens += msgTokens;
    }

    return [...systemMessages, ...kept];
  }

  /**
   * Aggressively compress messages to fit a smaller token budget.
   * Used when the TPM limit forces a smaller context.
   *
   * Strategy:
   *   1. Keep the system prompt
   *   2. Keep only the last 2-3 conversation turns (instead of 20)
   *   3. Truncate tool results to summaries
   */
  compressForTpmLimit(messages, targetInputTokens) {
    if (messages.length === 0) return [];

    const systemMessages = [];
    const conversationMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg);
      } else {
        conversationMessages.push(msg);
      }
    }

    const systemTokens = this.estimateMessagesTokens(systemMessages);
    const remainingBudget = targetInputTokens - systemTokens;

    if (remainingBudget <= 0) {
      // System prompt alone exceeds budget — truncate it hard
      return [{
        role: 'system',
        content: systemMessages[0]?.content?.slice(0, targetInputTokens * 4) || '',
      }];
    }

    // Keep only the last few messages (aggressive compression)
    const maxMessages = 4; // last 2 turns (user + assistant)
    const recentMessages = conversationMessages.slice(-maxMessages);

    const kept = [];
    let usedTokens = 0;

    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];
      let content = msg.content || '';

      // Truncate tool results aggressively
      if (msg.role === 'tool') {
        const maxToolResultLen = 200;
        if (content.length > maxToolResultLen) {
          content = content.slice(0, maxToolResultLen) + '... [truncated]';
        }
      }

      const msgTokens = this.estimateTokens(content) + 4;

      if (usedTokens + msgTokens > remainingBudget) break;

      kept.unshift({ ...msg, content });
      usedTokens += msgTokens;
    }

    return [...systemMessages, ...kept];
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}