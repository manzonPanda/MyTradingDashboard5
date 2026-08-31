/**
 * Behavior Engine — backend-computed confidence
 *
 * Confidence answers: "How confident is A.U.R.A. that this behavior is
 * actually present?" It is NEVER prediction accuracy and NEVER authored by the
 * LLM. It is blended deterministically from:
 *
 *   - evidence confidence (per-evidence LLM agreement, clamped 0..1)
 *   - occurrence_count (more consistent evidence → higher confidence, but
 *     sub-linearly to avoid "20 repeats = 100%")
 *   - consistency (how often the same behavior_type label was agreed)
 *   - recency (recent evidence weighs more; old stale evidence dampens)
 */

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(v) || 0));

/**
 * Evidence-level confidence used when persisting a new behavior_evidence row.
 * `llmConfidence` is the AI's agreement for THIS piece of evidence (0..1).
 * Backend keeps it inside a sane band and never lets a single datapoint
 * overreach.
 *
 * @param {number} llmConfidence 0..1
 * @param {number} [baseWeight] internal weight (default 1)
 */
export function evidenceConfidence(llmConfidence, baseWeight = 1) {
  const c = clamp(llmConfidence);
  // One datapoint can't justify more than a moderate baseline by itself.
  return clamp(0.35 + 0.45 * c * baseWeight);
}

/**
 * Blends a new evidence confidence into the behavior's running confidence.
 *
 * @param {object} p
 * @param {number} p.runningConfidence current behavior.confidence (0..1)
 * @param {number} p.runningCount       occurrence count BEFORE this evidence
 * @param {number} p.newEvidenceConf    evidenceConfidence() of the new row
 * @param {number} [p.recencyFactor]    0..1, 1 = fully recent (default 1)
 */
export function blendConfidence({ runningConfidence, runningCount, newEvidenceConf, recencyFactor = 1 }) {
  const cur = clamp(runningConfidence);
  const inc = clamp(newEvidenceConf) * clamp(recencyFactor);
  const n = Math.max(0, Number(runningCount) || 0);
  // Weighted running average + sublinear saturation toward the new signal.
  const weighted = (cur * n + inc) / (n + 1);
  const saturated = weighted + (inc - weighted) * Math.min(0.15, 1 / (n + 1));
  return clamp(Math.round(saturated * 10000) / 10000);
}

/**
 * Consistency factor from the behavior_type labels of prior evidence rows.
 * All agreeing → 1.0; mixed → lower (the behavior is less clearly one thing).
 *
 * @param {Array<{behavior_type?: string}>} evidenceRows
 * @param {string} dominantType 'positive' | 'negative'
 */
export function consistencyFactor(evidenceRows, dominantType) {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
  if (rows.length === 0) return 0.5;
  const agree = rows.filter((r) => (r.behavior_type ?? dominantType) === dominantType).length;
  return clamp(0.5 + 0.5 * (agree / rows.length));
}

/**
 * Final confidence for a behavior row after its aggregates are recomputed.
 * Combines the running blend with consistency and recency decay.
 *
 * @param {object} p
 * @param {number} p.blended      result of blendConfidence()
 * @param {number} p.consistency  consistencyFactor()
 * @param {number} p.recencyFactor 0..1
 */
export function finalConfidence({ blended, consistency, recencyFactor = 1 }) {
  return clamp(blended * (0.6 + 0.4 * clamp(consistency)) * (0.7 + 0.3 * clamp(recencyFactor)));
}