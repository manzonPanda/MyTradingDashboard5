/**
 * LLM Provider Abstraction — SINGLE ENTRY POINT
 *
 * The Behavior Engine and the AURA agent must never talk to a specific LLM
 * vendor directly. They import `createLLMProvider()` from this module and
 * program against the interface below. Swapping Ollama → Groq → a future
 * provider is a pure environment change (AI_PROVIDER env var), never a code
 * change in consumers.
 *
 * ─── Provider interface ─────────────────────────────────────────
 * Every provider implements:
 *
 *   get name(): string                      — provider id ('ollama' | 'groq' | …)
 *   get model(): string                     — active model id
 *   async chat(opts): Promise<LLMResult>    — non-streaming completion
 *   async chatStream(opts): Promise<LLMResult> — streaming completion
 *   resolveEffort(level): string | null     — map internal reasoning level to
 *                                             a provider-specific value (null =
 *                                             provider has no reasoning control)
 *   async checkHealth(): Promise<{ ok, detail }>
 *
 * opts (both chat methods):
 *   messages        — [{ role, content }] (OpenAI-style; 'tool' role allowed)
 *   tools           — OpenAI-style tool definitions or null
 *   toolChoice      — 'auto' (default)
 *   temperature     — number
 *   maxTokens       — number (generation cap)
 *   json            — boolean; request strict-JSON output mode when supported
 *   reasoningEffort — internal REASONING_LEVEL string ('none' | 'default')
 *   includeReasoning— boolean
 *   onToken         — (chunk: string) => void   (chatStream only)
 *   onReasoning     — (chunk: string) => void   (chatStream only)
 *
 * LLMResult (normalized — consumers must NOT touch vendor-specific shapes):
 *   { content: string, reasoning: string | null, toolCalls: ToolCall[] | null }
 *   where ToolCall = { id, function: { name, arguments: string } } (OpenAI-style,
 *   arguments always a JSON STRING — providers normalize vendor differences).
 */

import { GroqProvider } from './providers/groq-provider.js';
import { OllamaProvider } from './providers/ollama-provider.js';

// ─── Normalized provider errors ─────────────────────────────────
// Consumers catch these instead of vendor-specific error classes.

export class LLMError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'LLMError';
    if (options.cause) this.cause = options.cause;
  }
}

/** Transient 429-style rate limit. `retryAfter` is in seconds. */
export class LLMRateLimitError extends LLMError {
  constructor(retryAfterSeconds) {
    super(`Rate limit exceeded. Retry after ${retryAfterSeconds}s.`);
    this.name = 'LLMRateLimitError';
    this.retryAfter = retryAfterSeconds;
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(message = 'LLM request timed out.') {
    super(message);
    this.name = 'LLMTimeoutError';
  }
}

export class LLMConfigurationError extends LLMError {
  constructor(message) {
    super(message);
    this.name = 'LLMConfigurationError';
  }
}

export const AI_PROVIDER_ENV = {
  OLLAMA: 'ollama',
  GROQ: 'groq',
};

/**
 * Build the active provider from configuration.
 * AI_PROVIDER env var decides; 'groq' remains the default for backward
 * compatibility with the existing deployment. All Ollama knobs are env-driven
 * (OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_MS).
 *
 * @param {object} [overrides] - optional overrides for tests
 * @param {string} [overrides.provider]
 */
export function createLLMProvider(overrides = {}) {
  const providerName = String(
    overrides.provider ?? process.env.AI_PROVIDER ?? AI_PROVIDER_ENV.GROQ
  )
    .toLowerCase()
    .trim();

  switch (providerName) {
    case AI_PROVIDER_ENV.OLLAMA:
      return new OllamaProvider();
    case AI_PROVIDER_ENV.GROQ:
      return new GroqProvider();
    default:
      throw new LLMConfigurationError(
        `Unknown AI_PROVIDER "${providerName}". Supported: ${Object.values(AI_PROVIDER_ENV).join(', ')}.`
      );
  }
}
