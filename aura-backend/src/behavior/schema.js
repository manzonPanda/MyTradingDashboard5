/**
 * Behavior Engine — structured LLM output schema + validator
 *
 * NON-NEGOTIABLE RULE (hybrid-intelligence): the LLM output that this schema
 * validates carries ONLY interpretive fields — behavior name, description,
 * positive/negative classification, per-evidence reasons and confidence.
 *
 * OBJECTIVE fields (occurrence_count, pnl, R, timestamps, recurrence,
 * historical stats) are NEVER accepted from the model. Every objective number
 * must already be present in the analysis context as a backend-computed fact
 * and is persisted from the backend's own computation, not from this payload.
 *
 * Malformed output is rejected with a detailed error; the caller retries once
 * with a repair prompt, and if still invalid the analysis job is marked
 * failed/skipped. No partial write ever happens.
 */

export const AI_SCHEMA_VERSION = 'behavior-analysis.v1';

const ZERO_TO_ONE = (v) => typeof v === 'number' && v >= 0 && v <= 1 && Number.isFinite(v);

export class BehaviorValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BehaviorValidationError';
  }
}

const ALLOWED_TYPES = new Set(['positive', 'negative']);

// Reject any attempt by the LLM to inject backend-computed objective stats.
const FORBIDDEN_KEYS = [
  'occurrence_count', 'total_pnl', 'total_r', 'avg_r_per_trade',
  'win_rate', 'first_detected_at', 'last_detected_at',
  'estimated_impact_pnl', 'estimated_impact_r', 'impact_score',
];

function assertNoForbiddenKeys(obj, path) {
  for (const key of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      throw new BehaviorValidationError(`${path} must NOT contain backend-computed field "${key}".`);
    }
  }
}

const MAX_NAME = 160;
const MAX_DESCRIPTION = 1000;
const MAX_REASON = 600;
const MAX_EXCERPT = 500;
const MAX_EVIDENCE = 8; // upper bound per observation

/**
 * Validate ONE observation object.
 * Returns a normalized, trimmed copy; throws BehaviorValidationError with a
 * precise message when invalid.
 */
function validateObservation(obs, index) {
  if (!obs || typeof obs !== 'object' || Array.isArray(obs)) {
    throw new BehaviorValidationError(`observations[${index}]: must be an object`);
  }

  const name = typeof obs.behavior_name === 'string' ? obs.behavior_name.trim() : '';
  if (!name) throw new BehaviorValidationError(`observations[${index}].behavior_name: required non-empty string`);
  if (name.length > MAX_NAME) throw new BehaviorValidationError(`observations[${index}].behavior_name: exceeds ${MAX_NAME} chars`);

  const type = obs.type;
  if (!ALLOWED_TYPES.has(type)) {
    throw new BehaviorValidationError(`observations[${index}].type: must be 'positive' or 'negative'`);
  }

  const description = typeof obs.description === 'string' && obs.description.trim()
    ? obs.description.trim().slice(0, MAX_DESCRIPTION)
    : null;

  assertNoForbiddenKeys(obs, `observations[${index}]`);

  const confidence = obs.confidence;
  if (!ZERO_TO_ONE(confidence)) {
    throw new BehaviorValidationError(`observations[${index}].confidence: must be a number in [0,1]`);
  }

  // Evidence list — STRICT: every observation cites actual trades.
  const evidence = Array.isArray(obs.evidence) ? obs.evidence : [];
  if (evidence.length === 0) {
    throw new BehaviorValidationError(`observations[${index}].evidence: must not be empty (evidence-first design)`);
  }
  if (evidence.length > MAX_EVIDENCE) {
    throw new BehaviorValidationError(`observations[${index}].evidence: exceeds ${MAX_EVIDENCE} entries`);
  }

  const normalizedEvidence = evidence.map((ev, j) => {
    if (!ev || typeof ev !== 'object') {
      throw new BehaviorValidationError(`observations[${index}].evidence[${j}]: must be an object`);
    }
    assertNoForbiddenKeys(ev, `observations[${index}].evidence[${j}]`);
    const tradeId = typeof ev.trade_id === 'string' ? ev.trade_id.trim() : '';
    if (!tradeId) {
      throw new BehaviorValidationError(`observations[${index}].evidence[${j}].trade_id: required`);
    }
    const reason = typeof ev.reason === 'string' && ev.reason.trim() ? ev.reason.trim().slice(0, MAX_REASON) : null;
    const excerpt = typeof ev.reflection_excerpt === 'string' && ev.reflection_excerpt.trim()
      ? ev.reflection_excerpt.trim().slice(0, MAX_EXCERPT)
      : null;
    const evConfidence = ZERO_TO_ONE(ev.confidence) ? ev.confidence : null;
    return { trade_id: tradeId, reason, reflection_excerpt: excerpt, confidence: evConfidence };
  });

  return {
    behavior_name: name,
    type,
    description,
    confidence,
    evidence: normalizedEvidence,
  };
}

/**
 * Validate the full LLM analysis payload.
 *
 * @param {unknown} raw parsed JSON (or a string to parse)
 * @returns {object} normalized { observations: [...] }
 * @throws BehaviorValidationError with a human-readable path-precise message
 */
export function validateAnalysisPayload(raw) {
  let payload = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new BehaviorValidationError('Analysis output is not valid JSON.');
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BehaviorValidationError('Analysis output must be a JSON object with an `observations` array.');
  }

  const observations = Array.isArray(payload.observations) ? payload.observations : [];
  if (observations.length === 0) {
    throw new BehaviorValidationError('Analysis output contains no observations.');
  }
  if (observations.length > 20) {
    throw new BehaviorValidationError(`Analysis output has too many observations (${observations.length} > 20).`);
  }

  // Top-level forbidden keys (observations are checked per-item by
  // validateObservation via assertNoForbiddenKeys).
  for (const key of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new BehaviorValidationError(`Analysis output must NOT contain backend-computed field "${key}".`);
    }
  }

  return {
    schema_version: AI_SCHEMA_VERSION,
    observations: observations.map(validateObservation),
  };
}

/** Extract a repair prompt from the validation error (retry-once strategy). */
export function buildRepairPrompt(originalPrompt, validationError) {
  const reason = validationError?.message || 'unknown validation error';
  return {
    role: 'user',
    content: `Your previous response was rejected. Validation error: ${reason}\n\n`
      + 'Return ONLY a JSON object matching the exact schema, with an `observations` array. '
      + 'Every observation has { behavior_name, type, description, confidence, evidence: [{ trade_id, reason, reflection_excerpt, confidence }] }. '
      + 'Use only the trade_ids that were provided to you. Do not invent statistics such as occurrence counts, P&L, or R-multiples.\n\n'
      + `Original instructions:\n${originalPrompt}`,
  };
}