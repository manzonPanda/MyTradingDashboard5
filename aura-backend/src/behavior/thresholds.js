/**
 * Behavior Engine — lifecycle thresholds & per-account config
 *
 * Thresholds are DATA, not UI/backend-hardcoded values. Defaults live here;
 * a per-account `behavior_config` row can override any of them. The backend
 * merges defaults + stored config and applies the deterministic lifecycle.
 *
 * IMPORTANT (hybrid-intelligence rule): thresholds gate the BACKEND's objective
 * logic only. The LLM never sees raw occurrence thresholds as a source of truth
 * — it interprets evidence, the backend decides lifecycle.
 */

export const DEFAULT_THRESHOLDS = Object.freeze({
  // Lifecycle: how many occurrences escalate the status.
  emergingMin: 2, // 2–3 → EMERGING
  recurringMin: 4, // repeated negative evidence → RECURRING
  establishedMin: 5, // repeated positive evidence → ESTABLISHED

  // Trading-rule promotion (applied to ESTABLISHED, or RECURRING-eligible).
  ruleMinOccurrences: 6,
  ruleMinDistinctWeeks: 3,
  ruleMinReflections: 8,
  ruleMinConfidence: 0.75,

  // Resolution: no new evidence for N days → RESOLVED (inactive, reusable).
  resolutionInactiveDays: 30,

  // Alert anti-spam: cap of NEW alerts per behavior per rolling window,
  // and the window size used to build dedupe keys.
  alertMaxPerWindow: 3,
  alertWindowDays: 7,
});

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_THRESHOLDS));

/**
 * Merge a stored per-account config (jsonb) over the defaults.
 * Unknown keys are ignored — a malformed/hostile row can never inject
 * behavior into this module.
 *
 * @param {Record<string, number>} [stored] parsed behavior_config.thresholds
 * @returns {Record<string, number>}
 */
export function resolveThresholds(stored = null) {
  const merged = { ...DEFAULT_THRESHOLDS };
  if (!stored || typeof stored !== 'object') return merged;

  for (const [key, value] of Object.entries(stored)) {
    if (!KNOWN_KEYS.has(key)) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) merged[key] = num;
  }
  return merged;
}