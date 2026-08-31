/**
 * Groq Client - LLM reasoning engine wrapper
 *
 * Handles communication with Groq's API, including:
 *   - Chat completions
 *   - Tool/function calling
 *   - Streaming responses
 *   - Rate limit handling
 *   - Reasoning control (reasoning_effort + include_reasoning)
 *
 * The active model + its limits come from model-config.js (single source of
 * truth). This file never hard-codes a model id or a reasoning_effort string —
 * callers pass a REASONING_LEVEL and model-config maps it to the API value.
 */

import dotenv from 'dotenv';
import { getActiveModelConfig, resolveReasoningEffort, REASONING_LEVEL } from './model-config.js';

dotenv.config();

const { GROQ_API_KEY } = process.env;

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export class GroqClient {
  constructor() {
    this.apiKey = GROQ_API_KEY;
    // Single source of truth for the model id and limits.
    this.config = getActiveModelConfig();
    this.model = this.config.model;

    if (!this.apiKey) {
      console.warn('[Groq] GROQ_API_KEY not set — AURA will not function properly.');
    }
  }

  /** Resolve the concrete reasoning_effort API string for an internal level. */
  resolveEffort(level) {
    return resolveReasoningEffort(level, this.config);
  }


  /**
   * Non-streaming chat completion with optional tool calling.
   *
   * @param {object} opts
   * @param {string} opts.reasoningEffort - internal REASONING_LEVEL ('none'|'default').
   *   Resolved to the concrete API string via model-config. When the model can't
   *   reason or the level is NONE, no reasoning_effort field is sent.
   * @param {boolean} opts.includeReasoning - include reasoning tokens in the
   *   response (only meaningful when reasoning is enabled).
   */
  async chat({
    messages,
    tools = null,
    toolChoice = 'auto',
    temperature = 0.7,
    maxTokens = 1500,
    reasoningEffort = REASONING_LEVEL.NONE,
    includeReasoning = false,
    json = false,
  }) {
    if (!this.apiKey) throw new Error('GROQ_API_KEY is not configured.');

    const body = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };

    // Strict-JSON output mode (used by structured consumers, e.g. memory
    // extraction and future Behavior Engine analysis).
    if (json) {
      body.response_format = { type: 'json_object' };
    }

    // Reasoning control — only send what the active model supports.
    const effort = this.resolveEffort(reasoningEffort);
    if (effort !== null) {
      body.reasoning_effort = effort;
      // include_reasoning is only valid when reasoning is actually on.
      if (effort !== 'none' && includeReasoning) {
        body.include_reasoning = true;
      }
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = toolChoice;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60s timeout

    let response;
    try {
      response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Groq API request timed out after 60 seconds.');
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Groq API error (${response.status})`;

      try {
        const errorJson = JSON.parse(errorText);
        errorMsg = errorJson.error?.message || errorMsg;
      } catch {
        errorMsg = `${errorMsg}: ${errorText.slice(0, 200)}`;
      }

      // Rate limit handling
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') || '2';
        throw new GroqRateLimitError(parseInt(retryAfter, 10) || 2);
      }

      throw new Error(errorMsg);
    }

    const data = await response.json();
    return data;
  }

  /**
   * Streaming chat completion.
   * Calls onToken for each content chunk.
   * Calls onReasoning for each reasoning chunk (reasoning models). Returns the
   * full response when done.
   *
   * NOTE: Reasoning models emit "reasoning" deltas BEFORE the visible "content"
   * deltas. These reasoning tokens count toward max_tokens but are NOT part of
   * the visible response. We surface them via onReasoning so the UI can show
   * "thinking" activity, and we do NOT include them in the returned content.
   *
   * When reasoningEffort resolves to 'none' (or the model can't reason), no
   * reasoning_effort/include_reasoning fields are sent, so the model emits no
   * reasoning deltas — onReasoning simply never fires.
   */
  async chatStream({
    messages,
    tools = null,
    temperature = 0.7,
    maxTokens = 1500,
    onToken = null,
    onReasoning = null,
    reasoningEffort = REASONING_LEVEL.NONE,
    includeReasoning = false,
  }) {
    if (!this.apiKey) throw new Error('GROQ_API_KEY is not configured.');

    const body = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    };

    // Reasoning control — only send what the active model supports.
    const effort = this.resolveEffort(reasoningEffort);
    if (effort !== null) {
      body.reasoning_effort = effort;
      if (effort !== 'none' && includeReasoning) {
        body.include_reasoning = true;
      }
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000); // 120s timeout for reasoning models

    let response;
    try {
      response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Groq API stream request timed out after 120 seconds.');
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Groq API error (${response.status})`;

      try {
        const errorJson = JSON.parse(errorText);
        errorMsg = errorJson.error?.message || errorMsg;
      } catch {
        errorMsg = `${errorMsg}: ${errorText.slice(0, 200)}`;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') || '2';
        throw new GroqRateLimitError(parseInt(retryAfter, 10) || 2);
      }

      throw new Error(errorMsg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let fullReasoning = '';
    let toolCalls = [];
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;

        try {
          const chunk = JSON.parse(jsonStr);
          const delta = chunk.choices?.[0]?.delta;

          // Reasoning tokens (gpt-oss-120b) — surface as thinking, not content
          if (delta?.reasoning) {
            fullReasoning += delta.reasoning;
            onReasoning?.(delta.reasoning);
          }

          if (delta?.content) {
            fullContent += delta.content;
            onToken?.(delta.content);
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index || 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: tc.id, function: { name: '', arguments: '' } };
              }
              if (tc.function?.name) {
                toolCalls[idx].function.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                toolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        } catch {
          // Ignore parse errors for partial chunks
        }
      }
    }

    return {
      content: fullContent,
      reasoning: fullReasoning,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
    };
  }
}

export class GroqRateLimitError extends Error {
  constructor(retryAfter) {
    super(`Groq rate limit exceeded. Retry after ${retryAfter}s.`);
    this.retryAfter = retryAfter;
    this.name = 'GroqRateLimitError';
  }
}