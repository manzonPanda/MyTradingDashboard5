/**
 * Model Configuration - SINGLE SOURCE OF TRUTH
 *
 * This is the one place that knows about Groq models, their limits, and their
 * reasoning capabilities. The Groq client, the token manager, and the agent
 * ALL import from here — so changing the active model (or its limits) happens
 * in exactly one spot (the MODEL_REGISTRY below + the GROQ_MODEL env var).
 *
 * Why this exists:
 *   Previously groq-client.js defaulted to `llama-3.3-70b-versatile` while
 *   token-manager.js defaulted to `openai/gpt-oss-120b` — a silent mismatch
 *   where the client called one model and the budget logic assumed another.
 *   This module eliminates that inconsistency.
 *
 * Model-independent by design:
 *   - Each registry entry describes a model's limits + reasoning support.
 *   - Reasoning effort values are mapped per model. The agent never hard-codes
 *     an effort string; it asks the registry for the value that corresponds to
 *     a reasoning LEVEL.
 */

import dotenv from 'dotenv';

dotenv.config();

// ─── Reasoning levels (internal, model-independent) ──────────────
// The agent reasons in terms of these LEVELS. The registry maps each level
// to the concrete reasoning_effort string the model's API expects.
export const REASONING_LEVEL = {
  NONE: 'none', // No reasoning — fastest, cheapest, default for simple lookups
  DEFAULT: 'default', // Standard reasoning — for analysis / multi-source questions
};

// ─── Adaptive output budgets by complexity level ─────────────────
// These cap max_tokens PER REQUEST so we don't over-reserve output headroom
// (and thus TPM) for simple lookups that only produce ~300-600 tokens.
//
// Tuned so responses stay helpful (explanations + recommendations + follow-up
// suggestions) while staying well under the 8K TPM free-tier limit:
//   SIMPLE       ≈ 600   — factual lookup + brief context + 1-2 recommendations
//   ANALYSIS     ≈ 1000  — comparison + explanation + recommendations
//   DEEP_ANALYSIS ≈ 1400 — multi-source synthesis + detailed recommendations
//
// These are CAPS, not targets — the model may use fewer. The token manager
// still clamps to the remaining TPM ceiling so input + output never exceeds TPM.
export const OUTPUT_BUDGET_BY_LEVEL = {
  SIMPLE: 600,
  ANALYSIS: 1000,
  DEEP_ANALYSIS: 1400,
};

/** Resolve the output token cap for a given reasoning level. */
export function getOutputBudgetForLevel(level) {
  return OUTPUT_BUDGET_BY_LEVEL[level] ?? OUTPUT_BUDGET_BY_LEVEL.SIMPLE;
}

// ─── Model registry ──────────────────────────────────────────────
// `isReasoning` = the model supports reasoning tokens at all.
// `reasoningEffort` maps our internal REASONING_LEVEL → the API string.
//   - For reasoning-capable models (gpt-oss, qwen3.6): "none" disables
//     reasoning token generation; "default" enables standard reasoning.
//   - For non-reasoning models: every level maps to null (no param to send).
// `reasoningBudgetMultiplier` = extra output headroom reserved when reasoning
//   is enabled (reasoning tokens count toward max_tokens but aren't visible).
// Free-tier limits reflect the user's actual Groq dashboard.
const MODEL_REGISTRY = {
  'qwen/qwen3.6-27b': {
    tpmLimit: 8000,
    tpdLimit: 200000,
    rpmLimit: 30,
    maxContextTokens: 131072,
    maxCompletionTokens: 16384,
    maxInputTokens: 6000,
    maxOutputTokens: 1500,
    isReasoning: true,
    reasoningEffort: {
      [REASONING_LEVEL.NONE]: 'none',
      [REASONING_LEVEL.DEFAULT]: 'default',
    },
    reasoningBudgetMultiplier: 1.5,
  },
  'openai/gpt-oss-120b': {
    tpmLimit: 8000,
    tpdLimit: 200000,
    rpmLimit: 30,
    maxContextTokens: 131072,
    maxCompletionTokens: 65536,
    maxInputTokens: 4000,
    maxOutputTokens: 1000,
    isReasoning: true,
    reasoningEffort: {
      [REASONING_LEVEL.NONE]: 'none',
      [REASONING_LEVEL.DEFAULT]: 'default',
    },
    reasoningBudgetMultiplier: 1.5,
  },
  'openai/gpt-oss-20b': {
    tpmLimit: 8000,
    tpdLimit: 200000,
    rpmLimit: 30,
    maxContextTokens: 131072,
    maxCompletionTokens: 65536,
    maxInputTokens: 4000,
    maxOutputTokens: 1000,
    isReasoning: true,
    reasoningEffort: {
      [REASONING_LEVEL.NONE]: 'none',
      [REASONING_LEVEL.DEFAULT]: 'default',
    },
    reasoningBudgetMultiplier: 1.5,
  },
  'llama-3.3-70b-versatile': {
    tpmLimit: 8000,
    tpdLimit: 200000,
    rpmLimit: 30,
    maxContextTokens: 131072,
    maxCompletionTokens: 32768,
    maxInputTokens: 6000,
    maxOutputTokens: 1500,
    isReasoning: false,
    reasoningEffort: {
      [REASONING_LEVEL.NONE]: null,
      [REASONING_LEVEL.DEFAULT]: null,
    },
    reasoningBudgetMultiplier: 1,
  },
  'llama-3.1-8b-instant': {
    tpmLimit: 8000,
    tpdLimit: 200000,
    rpmLimit: 30,
    maxContextTokens: 131072,
    maxCompletionTokens: 131072,
    maxInputTokens: 6000,
    maxOutputTokens: 1500,
    isReasoning: false,
    reasoningEffort: {
      [REASONING_LEVEL.NONE]: null,
      [REASONING_LEVEL.DEFAULT]: null,
    },
    reasoningBudgetMultiplier: 1,
  },
};

const DEFAULT_MODEL_CONFIG = {
  tpmLimit: 8000,
  tpdLimit: 200000,
  rpmLimit: 30,
  maxContextTokens: 131072,
  maxCompletionTokens: 8192,
  maxInputTokens: 4000,
  maxOutputTokens: 1000,
  isReasoning: false,
  reasoningEffort: {
    [REASONING_LEVEL.NONE]: null,
    [REASONING_LEVEL.DEFAULT]: null,
  },
  reasoningBudgetMultiplier: 1,
};

const {
  GROQ_MODEL = 'qwen/qwen3.6-27b',
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  TPM_LIMIT,
  TPD_LIMIT,
} = process.env;

/**
 * Resolve the active model configuration.
 * Env overrides (MAX_INPUT_TOKENS, etc.) take precedence over the registry so
 * budgets can be tightened without editing code. The model id is always GROQ_MODEL.
 */
export function getActiveModelConfig() {
  const model = GROQ_MODEL;
  const registry = MODEL_REGISTRY[model] || DEFAULT_MODEL_CONFIG;

  const config = {
    model,
    tpmLimit: TPM_LIMIT ? parseInt(TPM_LIMIT, 10) : registry.tpmLimit,
    tpdLimit: TPD_LIMIT ? parseInt(TPD_LIMIT, 10) : registry.tpdLimit,
    rpmLimit: registry.rpmLimit,
    maxContextTokens: registry.maxContextTokens,
    maxCompletionTokens: registry.maxCompletionTokens,
    maxInputTokens: MAX_INPUT_TOKENS
      ? parseInt(MAX_INPUT_TOKENS, 10)
      : registry.maxInputTokens,
    maxOutputTokens: MAX_OUTPUT_TOKENS
      ? parseInt(MAX_OUTPUT_TOKENS, 10)
      : registry.maxOutputTokens,
    isReasoning: registry.isReasoning,
    reasoningEffort: registry.reasoningEffort,
    reasoningBudgetMultiplier: registry.reasoningBudgetMultiplier,
  };

  if (!MODEL_REGISTRY[model]) {
    console.warn(
      `[model-config] GROQ_MODEL="${model}" is not in MODEL_REGISTRY. ` +
        `Using conservative defaults. Add it to model-config.js for accurate budgets.`
    );
  }

  return config;
}

// ─── Reasoning helpers ───────────────────────────────────────────

/** Does the active model support reasoning at all? */
export function supportsReasoning(config = getActiveModelConfig()) {
  return !!config.isReasoning;
}

/**
 * Resolve the concrete reasoning_effort API string for a given internal level.
 * Returns null when the model can't reason or the level maps to nothing —
 * in which case the caller should NOT send a reasoning_effort field at all.
 */
export function resolveReasoningEffort(level, config = getActiveModelConfig()) {
  if (!config.isReasoning) return null;
  return config.reasoningEffort?.[level] ?? null;
}

/**
 * Whether reasoning is actually ON for a given level on the active model.
 * (A reasoning-capable model with effort "none" is effectively reasoning-OFF.)
 */
export function isReasoningEnabled(level, config = getActiveModelConfig()) {
  const effort = resolveReasoningEffort(level, config);
  return effort !== null && effort !== 'none';
}

