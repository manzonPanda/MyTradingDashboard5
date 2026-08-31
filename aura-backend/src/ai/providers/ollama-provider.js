/**
 * Ollama provider — local / self-hosted LLM (Oracle VM, GPU VM, local PC).
 *
 * Uses Ollama's native /api/chat endpoint:
 *   POST {OLLAMA_BASE_URL}/api/chat
 *   { model, messages, stream, tools?, format?, options? }
 *
 * Streaming responses are NDJSON (one JSON object per line). Tool calls follow
 * the OpenAI-style shape but `arguments` arrives as an OBJECT — it is
 * normalized to a JSON string here so consumers see one consistent format.
 *
 * Configuration (env — never hardcoded):
 *   OLLAMA_BASE_URL   default http://localhost:11434
 *   OLLAMA_MODEL      default llama3.1:8b
 *   OLLAMA_TIMEOUT_MS default 120000 (local models can be slow on first load)
 */

import { LLMError, LLMRateLimitError, LLMTimeoutError } from '../provider.js';

export class OllamaProvider {
  constructor() {
    this.baseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    this.modelId = process.env.OLLAMA_MODEL || 'llama3.1:8b';
    this.timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '120000', 10);
  }

  get name() {
    return 'ollama';
  }

  get model() {
    return this.modelId;
  }

  /**
   * Ollama has no reasoning_effort API parameter — thinking models manage
   * reasoning themselves. Returning null tells callers NOT to send one.
   */
  resolveEffort() {
    return null;
  }

  buildRequestBody(opts, stream) {
    const body = {
      model: this.modelId,
      messages: opts.messages ?? [],
      stream,
      options: {
        temperature: opts.temperature ?? 0.7,
        ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
      },
    };

    // Structured-output mode (used by the Behavior Engine in Phase 2 to force
    // valid JSON before server-side schema validation).
    if (opts.json) {
      body.format = 'json';
    }

    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
    }

    return body;
  }

  async request(body, { timeoutMs = this.timeoutMs } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        throw new LLMTimeoutError(`Ollama request timed out after ${timeoutMs}ms.`);
      }
      throw new LLMError(`Ollama request failed: ${err?.message || err}`, { cause: err });
    }
    clearTimeout(timeoutId);
    return response;
  }

  /** Map Ollama HTTP failures onto the normalized error hierarchy. */
  async mapHttpError(response) {
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '2', 10);
      throw new LLMRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 2);
    }
    let detail = '';
    try {
      const text = await response.text();
      try {
        detail = JSON.parse(text)?.error || text.slice(0, 300);
      } catch {
        detail = text.slice(0, 300);
      }
    } catch {
      detail = '';
    }
    throw new LLMError(`Ollama API error (${response.status}): ${detail}`);
  }

  /** Normalize Ollama tool_calls (arguments as OBJECT) to OpenAI-style strings. */
  static normalizeToolCalls(toolCalls) {
    if (!toolCalls || toolCalls.length === 0) return null;
    return toolCalls.map((tc, index) => ({
      id: tc.id || `ollama_tc_${index}`,
      function: {
        name: tc.function?.name ?? '',
        arguments:
          typeof tc.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments ?? {}),
      },
    }));
  }

  async chat(opts) {
    const response = await this.request(this.buildRequestBody(opts, false));
    if (!response.ok) await this.mapHttpError(response);

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new LLMError('Ollama returned a non-JSON response.', { cause: err });
    }

    const message = payload?.message;
    if (!message) {
      throw new LLMError('Ollama returned an unexpected response shape (no message).');
    }

    return {
      content: message.content ?? '',
      reasoning: message.thinking ?? null,
      toolCalls: OllamaProvider.normalizeToolCalls(message.tool_calls),
    };
  }

  async chatStream(opts) {
    const response = await this.request(this.buildRequestBody(opts, true));
    if (!response.ok) await this.mapHttpError(response);
    if (!response.body) throw new LLMError('Ollama streaming response has no body.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';
    let toolCalls = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk;
        try {
          chunk = JSON.parse(trimmed);
        } catch {
          continue; // ignore partial/invalid NDJSON lines
        }

        if (chunk.error) {
          throw new LLMError(`Ollama stream error: ${chunk.error}`);
        }

        const message = chunk.message;
        if (message?.thinking) {
          reasoning += message.thinking;
          opts.onReasoning?.(message.thinking);
        }
        if (message?.content) {
          content += message.content;
          opts.onToken?.(message.content);
        }
        if (message?.tool_calls?.length) {
          toolCalls = toolCalls ?? [];
          toolCalls.push(...message.tool_calls);
        }
      }
    }

    return {
      content,
      reasoning: reasoning || null,
      toolCalls: OllamaProvider.normalizeToolCalls(toolCalls),
    };
  }

  /**
   * Health = Ollama daemon reachable AND the configured model is available.
   * GET /api/tags lists installed models — cheap, no inference.
   */
  async checkHealth() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) {
        return { ok: false, detail: `Ollama responded with HTTP ${response.status}.` };
      }
      const payload = await response.json();
      const models = (payload?.models || []).map((m) => m?.name).filter(Boolean);
      const hasModel = models.some(
        (m) => m === this.modelId || m.split(':')[0] === this.modelId.split(':')[0]
      );
      return {
        ok: hasModel,
        detail: hasModel
          ? `reachable (model: ${this.modelId})`
          : `reachable but model "${this.modelId}" not installed (available: ${
              models.slice(0, 5).join(', ') || 'none'
            })`,
      };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { ok: false, detail: `Ollama not reachable within 3s at ${this.baseUrl}.` };
      }
      return { ok: false, detail: `Ollama not reachable at ${this.baseUrl}: ${err?.message || err}` };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
