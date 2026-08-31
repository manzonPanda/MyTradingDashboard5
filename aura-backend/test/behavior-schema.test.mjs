/**
 * Behavior Engine — schema validation tests (Stage D)
 *
 * Verifies the hybrid-intelligence guardrail: LLM output may carry only
 * interpretive fields; objective statistics are rejected; malformed output
 * throws BehaviorValidationError with precise paths.
 *
 * Run: node test/behavior-schema.test.mjs
 */

import assert from 'node:assert/strict';
import {
  validateAnalysisPayload,
  buildRepairPrompt,
  BehaviorValidationError,
  AI_SCHEMA_VERSION,
} from '../src/behavior/schema.js';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };
const rejectsWith = async (fn, sub) => {
  try {
    await fn();
    assert.fail('expected BehaviorValidationError');
  } catch (err) {
    assert.ok(err instanceof BehaviorValidationError, `expected BehaviorValidationError, got ${err.constructor.name}`);
    if (sub) assert.ok(err.message.includes(sub), `expected "${sub}" in "${err.message}"`);
  }
};

const LP = `
You are analyzing a single trade for a trading behavior engine.
Here are the trade facts (backend-computed) and the trader's reflection.
Respond ONLY with JSON in the required schema.
`;

const validPayload = {
  observations: [
    {
      behavior_name: 'Revenge Trading',
      type: 'negative',
      description: 'Enters quickly after a loss to recover P&L.',
      confidence: 0.82,
      evidence: [
        { trade_id: 'trade-481', reason: 'Immediately re-entered after a loss.', reflection_excerpt: 'I wanted to recover the previous loss.', confidence: 0.8 },
        { trade_id: 'trade-489', reason: 'Entered again to make back losses.', reflection_excerpt: 'Entered immediately.', confidence: 0.75 },
      ],
    },
  ],
};

// ─── valid payload ─────────────────────────────────────────────
{
  console.log('valid payload');
  const out = validateAnalysisPayload(validPayload);
  assert.equal(out.schema_version, AI_SCHEMA_VERSION);
  assert.equal(out.observations.length, 1);
  assert.equal(out.observations[0].behavior_name, 'Revenge Trading');
  assert.equal(out.observations[0].type, 'negative');
  assert.equal(out.observations[0].evidence.length, 2);
  ok('valid payload normalizes');
}

// ─── malformed JSON / structures ───────────────────────────────
{
  console.log('malformed payloads');
  await rejectsWith(() => validateAnalysisPayload('{not json'), 'not valid JSON');
  await rejectsWith(() => validateAnalysisPayload(null), 'must be a JSON object');
  await rejectsWith(() => validateAnalysisPayload([]), 'must be a JSON object');
  await rejectsWith(() => validateAnalysisPayload({ observations: [] }), 'contains no observations');
  ok('malformed JSON/structures rejected');
}

// ─── observation-level validation ──────────────────────────────
{
  console.log('observation-level validation');
  const base = () => structuredClone(validPayload);

  await rejectsWith(() => validateAnalysisPayload({ observations: [{ ...base().observations[0], behavior_name: '' }] }), 'behavior_name');
  await rejectsWith(() => validateAnalysisPayload({ observations: [{ ...base().observations[0], behavior_name: 'x'.repeat(200) }] }), 'exceeds');
  await rejectsWith(() => validateAnalysisPayload({ observations: [{ ...base().observations[0], type: 'neutral' }] }), "must be 'positive' or 'negative'");
  await rejectsWith(() => validateAnalysisPayload({ observations: [{ ...base().observations[0], confidence: 1.2 }] }), 'confidence');
  await rejectsWith(() => validateAnalysisPayload({ observations: [{ ...base().observations[0], confidence: '0.8' }] }), 'confidence');
  await rejectsWith(() => validateAnalysisPayload({ observations: [{ ...base().observations[0], evidence: [] }] }), 'must not be empty');
  await rejectsWith(
    () => validateAnalysisPayload({ observations: [{ ...base().observations[0], evidence: [{ reason: 'no trade id' }] }] }),
    'trade_id'
  );
  ok('observation-level rules enforced with precise paths');
}

// ─── hybrid-guardrail: objective stats forbidden ───────────────
{
  console.log('objective statistics rejection');
  const withTop = { ...validPayload, occurrence_count: 3 };
  await rejectsWith(() => validateAnalysisPayload(withTop), 'occurrence_count');
  const withNested = structuredClone(validPayload);
  withNested.observations[0].total_pnl = -188;
  await rejectsWith(() => validateAnalysisPayload(withNested), 'total_pnl');
  const withImpact = structuredClone(validPayload);
  withImpact.observations[0].evidence[0].estimated_impact_r = -2.5;
  await rejectsWith(() => validateAnalysisPayload(withImpact), 'estimated_impact_r');
  ok('LLM cannot inject backend-computed statistics');
// ─── normalization ─────────────────────────────────────────────
{
  console.log('normalization');
  const messy = structuredClone(validPayload);
  messy.observations[0].description = '  padded  ';
  messy.observations[0].evidence[0].reflection_excerpt = '  trimmed  ';
  const out = validateAnalysisPayload(messy);
  assert.equal(out.observations[0].description, 'padded');
  assert.equal(out.observations[0].evidence[0].reflection_excerpt, 'trimmed');
  // missing optional reason/excerpt/confidence become null
  const sparse = structuredClone(validPayload);
  delete sparse.observations[0].evidence[0].reflection_excerpt;
  const out2 = validateAnalysisPayload(sparse);
  assert.equal(out2.observations[0].evidence[0].reflection_excerpt, null);
  ok('optional fields trimmed / nulled');
}

// ─── repair prompt ─────────────────────────────────────────────
{
  console.log('repair prompt');
  const err = new BehaviorValidationError('observations[0].confidence: must be a number in [0,1]');
  const repair = buildRepairPrompt(LP, err);
  assert.ok(repair.role === 'user');
  assert.ok(repair.content.includes('Validation error: observations[0].confidence'));
  assert.ok(repair.content.includes('schema'));
  ok('repair prompt embeds the validation error + schema instructions');
}

console.log(`\nAll ${passed} schema tests passed.`);
}