/**
 * Behavior Engine — deterministic lifecycle
 *
 *   DETECTED (1)
 *     → EMERGING (>= emergingMin)
 *     → RECURRING (>= recurringMin, negative)   |   ESTABLISHED (>= establishedMin, positive)
 *     → RULE_CANDIDATE (established + rule thresholds)
 *
 * Inactivity resolution:
 *   any ACTIVE status with no new evidence for `resolutionInactiveDays`
 *   → RESOLVED. RESOLVED is a terminal-but-reusable state: the row is kept
 *   (history preserved) but hidden from active views. New evidence
 *   reactivates it.
 *
 * ARCHIVED is always user-initiated (or superseded) and never auto-occurs.
 *
 * These transitions are PURE and deterministic — unit-testable without a DB.
 */

import { resolveThresholds } from './thresholds.js';

export const BEHAVIOR_STATUS = Object.freeze({
  DETECTED: 'DETECTED',
  EMERGING: 'EMERGING',
  RECURRING: 'RECURRING',
  ESTABLISHED: 'ESTABLISHED',
  RULE_CANDIDATE: 'RULE_CANDIDATE',
  RESOLVED: 'RESOLVED',
  ARCHIVED: 'ARCHIVED',
});

export const ACTIVE_STATUSES = Object.freeze([
  BEHAVIOR_STATUS.DETECTED,
  BEHAVIOR_STATUS.EMERGING,
  BEHAVIOR_STATUS.RECURRING,
  BEHAVIOR_STATUS.ESTABLISHED,
  BEHAVIOR_STATUS.RULE_CANDIDATE,
]);

/**
 * Compute the next lifecycle status from objective evidence.
 *
 * @param {object} p
 * @param {string} p.currentStatus      existing behavior.status
 * @param {string} p.behaviorType       'positive' | 'negative'
 * @param {number} p.occurrenceCount    backend-computed occurrence count
 * @param {number} [p.distinctWeeks]    backend-computed distinct-week count
 * @param {number} [p.reflectionCount]  backend-computed reflection-linked count
 * @param {number} [p.confidence]       backend-computed confidence (0..1)
 * @param {Record<string, number>} [p.thresholds] resolved per-account thresholds
 * @returns {string} new status
 */
export function computeStatus({
  currentStatus,
  behaviorType,
  occurrenceCount,
  distinctWeeks = 0,
  reflectionCount = 0,
  confidence = 0,
  thresholds = null,
}) {
  const t = resolveThresholds(thresholds);

  // Terminal states only change via explicit external actions.
  if (currentStatus === BEHAVIOR_STATUS.ARCHIVED) return BEHAVIOR_STATUS.ARCHIVED;

  // RESOLVED reactivates to DETECTED/EMERGING when new evidence arrives;
  // the new occurrence already bumped the count before this call.
  if (currentStatus === BEHAVIOR_STATUS.RESOLVED) {
    if (occurrenceCount >= t.emergingMin) return BEHAVIOR_STATUS.EMERGING;
    return BEHAVIOR_STATUS.DETECTED;
  }

  // Active lifecycle — monotonic escalation per behavior type.
  if (behaviorType === 'positive') {
    if (occurrenceCount >= t.ruleMinOccurrences &&
        distinctWeeks >= t.ruleMinDistinctWeeks &&
        reflectionCount >= t.ruleMinReflections &&
        confidence >= t.ruleMinConfidence) {
      return BEHAVIOR_STATUS.RULE_CANDIDATE;
    }
    if (occurrenceCount >= t.establishedMin) return BEHAVIOR_STATUS.ESTABLISHED;
    if (occurrenceCount >= t.emergingMin) return BEHAVIOR_STATUS.EMERGING;
    return BEHAVIOR_STATUS.DETECTED;
  }

  // negative
  if (occurrenceCount >= t.recurringMin &&
      distinctWeeks >= t.ruleMinDistinctWeeks &&
      reflectionCount >= t.ruleMinReflections &&
      confidence >= t.ruleMinConfidence) {
    return BEHAVIOR_STATUS.RULE_CANDIDATE;
  }
  if (occurrenceCount >= t.recurringMin) return BEHAVIOR_STATUS.RECURRING;
  if (occurrenceCount >= t.emergingMin) return BEHAVIOR_STATUS.EMERGING;
  return BEHAVIOR_STATUS.DETECTED;
}

/**
 * Inactivity resolution. Returns RESOLVED once an active behavior has had no
 * new evidence for `resolutionInactiveDays`, or null when still active.
 * RESOLVED in → null (stays resolved until reactivated by new evidence).
 */
export function resolveIfInactive({ status, lastDetectedAt, now = new Date(), thresholds = null }) {
  if (!ACTIVE_STATUSES.includes(status)) return null;
  if (!lastDetectedAt) return null;
  const t = resolveThresholds(thresholds);
  const idleMs = now.getTime() - new Date(lastDetectedAt).getTime();
  const inactiveMs = t.resolutionInactiveDays * 24 * 60 * 60 * 1000;
  return idleMs >= inactiveMs ? BEHAVIOR_STATUS.RESOLVED : null;
}