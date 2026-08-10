/**
 * Reasoning Router - DETERMINISTIC complexity classifier
 *
 * Decides whether to enable reasoning for a given user message WITHOUT calling
 * another LLM (that would waste Groq TPM on the free tier). It uses lightweight
 * keyword/phrase heuristics + query characteristics instead.
 *
 * Output: { level, reasoningEffort, reason }
 *   level           → 'SIMPLE' | 'ANALYSIS' | 'DEEP_ANALYSIS'
 *   reasoningEffort → 'none' | 'default'  (internal REASONING_LEVEL value; the
 *                     Groq client maps it to the concrete API string via
 *                     model-config.resolveReasoningEffort)
 *   reason          → human-readable explanation (surfaced as a thinking event
 *                     for debugging; not a user-facing setting)
 *
 * Default is reasoning OFF (SIMPLE / effort "none") — reasoning is only enabled
 * when it materially improves the answer. The agent may ESCALATE (SIMPLE →
 * DEFAULT) at runtime if a "simple" question turns out to need multiple tools.
 */

import { REASONING_LEVEL } from './model-config.js';

// DEEP_ANALYSIS: cross-period behavioral analysis, pattern discovery,
// synthesis across trades + journal + rules + memories.
const DEEP_ANALYSIS_PATTERNS = [
  /\bwhy do i keep\b/i,
  /\bwhy am i (always|consistently|repeatedly)\b/i,
  /\b(recurring|repeating)\s+(pattern|mistake|error)s?\b/i,
  /\b(find|identify|uncover)\s+(pattern|recurring|repeating)\b/i,
  /\banaly[sz]e\s+(my )?(trading )?(behavior|behaviour|performance)\b/i,
  /\bover (the )?(last|past)\s*\d*\s*(month|week|quarter|year)s?\b/i,
  /\b(last|past)\s+\d+\s*(month|week|quarter|year)s?\b/i,
  /\bcompare\b.*\b(journal|rules|memories|behavior|behaviour|performance)\b/i,
  /\b(journal entries|reflections)\b.*\b(trading|actual|behavior|behaviour|compare)\b/i,
  /\bbiggest weakness(es)?\b/i,
  /\broot cause\b/i,
  /\bwhat (are|were) my (biggest|main|key)\s*(weakness|mistake|pattern|problem)s?\b/i,
  /\brevenge trading\b/i,
  /\btilt\b/i,
  /\bself.?sabotage\b/i,
  /\b(psycholog|behavioural|behavioral)\s*(pattern|issue|problem|analysis)s?\b/i,
  /\b(deeper analysis|deep dive|deep look)\b/i,
  /\b(find|spot|identify) (recurring|repeating) (mistake|error|pattern)s?\b/i,
  // NOTE: bare "overtrading" is NOT deep by itself — "Am I overtrading?" is a
  // rule-check (ANALYSIS). Deep cases like "why do I keep overtrading" are
  // caught by the "why do i keep" / "why am i" patterns above.
];

// ANALYSIS: comparisons, "which is best", performance review, rule checks.
const ANALYSIS_PATTERNS = [
  /\bhow did i (perform|do)\b/i,
  /\bhow am i (doing|performing)\b/i,
  /\bwhich (setup|strategy|instrument|symbol)s?\s+(is|are|perform|performing)\b/i,
  /\bcompare\b.*\b(this|last)\s*(week|month|day|period)\b/i,
  /\bam i (overtrading|following my rules|breaking|risk)\b/i,
  /\bam i following\b/i,
  /\b(performance) (review|summary|analysis)\b/i,
  /\bwhat.?s? (my )?(best|worst|biggest) (setup|strategy|trade|day|week|mistake)s?\b/i,
  /\b(improve|improvement|better) (my )?(trading|performance|results)\b/i,
  /\b(what|where) (am i|do i) (lose|losing|lose money|go wrong|struggling|struggle)\b/i,
  /\btrend\b.*\b(performance|pnl|result|win|loss)\b/i,
  /\bwhich (days|sessions|times)\b.*\b(best|worst|most|profit|loss)\b/i,
  /\b(risk|money) management\b.*\b(check|review|how|am i)\b/i,
  /\bconsistent(ly)?\b.*\b(losing|winning|profit|loss)\b/i,
  /\bdrawdown\b.*\b(why|cause|reason|trend|analyze)\b/i,
  /\bwhat should i (do|change|improve|stop|start)\b/i,
];

// SIMPLE: direct factual lookups, counts, "what/when/where is my X".
const SIMPLE_PATTERNS = [
  /\b(what.?s|what is|what was) my (last|latest|current|next)\b/i,
  /\bwhen (was|did) (i|my) (last|latest|most recent)\b/i,
  /\bhow much (did i|have i|do i)\b/i,
  /\bhow many (trades|winners|losers|days)\b/i,
  /\b(current )?(drawdown|balance|equity|pnl|profit|loss)\b/i,
  /\b(show|get|tell) me my (last|latest|recent|current)\b/i,
  /\bwhat time (did|was) (i|my)\b/i,
  /\bopen positions?\b/i,
  /\b(my )?last trade\b/i,
  /\btoday.?s? (pnl|profit|loss|trades|result)\b/i,
  /\bthis week.?s? (pnl|profit|loss|trades|count)\b/i,
  /\bthis month.?s? (pnl|profit|loss|trades|count)\b/i,
  /\bhow many trades (did|have|this)\b/i,
  /\b(what|which) (instrument|symbol)s? (did i|have i)\b/i,
  /\bremember (this|that|the following)\b/i,
  /\b(save|note|keep) (this|that|the following)\b/i,
];

function matchesAny(text, patterns) {
  return patterns.some((p) => p.test(text));
}

/**
 * Classify a user message into a reasoning level using deterministic heuristics.
 * NO LLM call — this is a lightweight regex/keyword router.
 *
 * @param {string} message - The raw user message.
 * @param {string} [intent] - context-builder intent (trading_data, memory,
 *   analysis, action, conversation). Optional tie-breaker.
 * @returns {{level:string, reasoningEffort:string, reason:string}}
 */
export function classifyReasoning(message, intent) {
  const text = message || '';
  const lower = text.toLowerCase();

  // 1. DEEP_ANALYSIS wins outright if any deep signal is present.
  if (matchesAny(lower, DEEP_ANALYSIS_PATTERNS)) {
    return {
      level: 'DEEP_ANALYSIS',
      reasoningEffort: REASONING_LEVEL.DEFAULT,
      reason: 'Multi-period behavioral / cross-source analysis',
    };
  }

  // 2. ANALYSIS signals.
  if (matchesAny(lower, ANALYSIS_PATTERNS)) {
    return {
      level: 'ANALYSIS',
      reasoningEffort: REASONING_LEVEL.DEFAULT,
      reason: 'Performance comparison / analytical question',
    };
  }

  // 3. SIMPLE signals.
  if (matchesAny(lower, SIMPLE_PATTERNS)) {
    return {
      level: 'SIMPLE',
      reasoningEffort: REASONING_LEVEL.NONE,
      reason: 'Simple factual trade lookup',
    };
  }

  // 4. Fallback by intent (when explicit patterns don't fire).
  if (intent === 'analysis') {
    return {
      level: 'ANALYSIS',
      reasoningEffort: REASONING_LEVEL.DEFAULT,
      reason: 'Analytical intent detected',
    };
  }

  // 5. Very short messages (greetings, small talk) → SIMPLE, no reasoning.
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= 6) {
    return {
      level: 'SIMPLE',
      reasoningEffort: REASONING_LEVEL.NONE,
      reason: 'Short conversational message',
    };
  }

  // 6. Default: SIMPLE with reasoning OFF. The agent may escalate at runtime
  // if it discovers the question needs multiple tools / data sources.
  return {
    level: 'SIMPLE',
    reasoningEffort: REASONING_LEVEL.NONE,
    reason: 'Default — reasoning OFF unless agent escalates',
  };
}

/**
 * Whether the agent should ESCALATE reasoning for the current turn.
 * Called after observing tool usage: if a "simple" question required multiple
 * tools or touched memories + journal + trades, bump reasoning ON.
 *
 * @param {object} ctx - { level, toolCallsCount, usedMemory, usedJournal }
 * @returns {boolean}
 */
export function shouldEscalateReasoning({ level, toolCallsCount, usedMemory, usedJournal }) {
  if (level !== 'SIMPLE') return false; // already reasoning
  // Multiple data sources = the question is more analytical than it looked.
  const dataSources =
    (usedMemory ? 1 : 0) + (usedJournal ? 1 : 0) + (toolCallsCount >= 2 ? 1 : 0);
  return dataSources >= 2;
}

