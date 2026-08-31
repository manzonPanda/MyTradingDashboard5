/**
 * Groq provider — thin adapter over the existing GroqClient.
 *
 * Responsibility: translate the provider interface (see ai/provider.js) to
 * Groq's OpenAI-compatible API and NORMALIZE the response shape so consumers
 * never see vendor structures. This file adds no Groq logic of its own —
 * timeouts, retries, reasoning-effort mapping and model config stay in
 * groq-client.js / model-config.js (existing single source of truth).
 */

import { GroqClient, GroqRateLimitError } from '../../groq-client.js';
import { LLMError, LLMRateLimitError, LLMConfigurationError } from '../provider.js';

export class GroqProvider {
  constructor() {
    this.client = new GroqClient();
  }

  get name() {
    return 'groq';
  }

  get model() {
    return this.client.model;
  }

  resolveEffort(level) {
    return this.client.resolveEffort(level);
  }

  /** Map vendor errors onto the normalized error hierarchy. */
  mapError(err) {
    if (err instanceof GroqRateLimitError) {
      return new LLMRateLimitError(err.retryAfter ?? 2);
    }
    if (err instanceof LLMError) return err;
    return new LLMError(err?.message || 'Groq request failed.', { cause: err });
  }

  /**
   * Non-streaming completion. Normalizes the raw OpenAI-style Groq response
   * into { content, reasoning, toolCalls }.
   */
  async chat(opts) {
    try {
      const response = await this.client.chat({
        messages: opts.messages,
        tools: opts.tools ?? null,
        toolChoice: opts.toolChoice ?? 'auto',
        temperature: opts.temperature ?? 0.7,
        maxTokens: opts.maxTokens ?? 1500,
        reasoningEffort: opts.reasoningEffort,
        includeReasoning: opts.includeReasoning ?? false,
        json: opts.json ?? false,
      });
      return GroqProvider.normalize(response);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /**
   * Streaming completion. GroqClient.chatStream already returns the normalized
   * shape ({ content, reasoning, toolCalls }) and invokes onToken/onReasoning.
   */
  async chatStream(opts) {
    try {
      const result = await this.client.chatStream({
        messages: opts.messages,
        tools: opts.tools ?? null,
        toolChoice: opts.toolChoice ?? 'auto',
        temperature: opts.temperature ?? 0.7,
        maxTokens: opts.maxTokens ?? 1500,
        onToken: opts.onToken,
        onReasoning: opts.onReasoning,
        reasoningEffort: opts.reasoningEffort,
        includeReasoning: opts.includeReasoning ?? false,
      });
      return {
        content: result.content ?? '',
        reasoning: result.reasoning ?? null,
        toolCalls: result.toolCalls ?? null,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /**
   * Health = configured + model resolvable. Intentionally NO network call —
   * a free-tier ping on every /health poll would burn RPM budget.
   */
  async checkHealth() {
    if (!process.env.GROQ_API_KEY) {
      return { ok: false, detail: 'GROQ_API_KEY is not configured.' };
    }
    return { ok: true, detail: `configured (model: ${this.model})` };
  }

  /**
   * Normalize a raw Groq/OpenAI chat-completion response.
   * toolCalls arguments are already strings in the OpenAI format.
   */
  static normalize(response) {
    const message = response?.choices?.[0]?.message;
    if (!message) {
      throw new LLMConfigurationError('Groq returned an unexpected response shape (no message).');
    }
    return {
      content: message.content ?? '',
      reasoning: message.reasoning ?? null,
      toolCalls: message.tool_calls ?? null,
    };
  }
}
