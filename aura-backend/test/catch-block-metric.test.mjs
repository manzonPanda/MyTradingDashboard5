/**
 * Runtime test for the agent catch-block path.
 * Simulates a Groq call that THROWS on iteration 1, which previously crashed
 * with "modelStart is not defined" (a block-scoping bug). Verifies the run()
 * now handles the error gracefully instead of throwing ReferenceError.
 */
import { AuraAgent } from '../src/agent.js';
import { GroqRateLimitError } from '../src/groq-client.js';

// ─── Mocks ─────────────────────────────────────────────────────
const failingGroq = {
  model: 'qwen/qwen3.6-27b',
  resolveEffort: () => 'none',
  // Iteration 1 (non-final, tool path): throw a REAL rate-limit error so the
  // catch block executes exactly the code that crashed before.
  chat: async () => {
    // Use the real error class (instanceof GroqRateLimitError → retry path)
    throw new GroqRateLimitError(1);
  },
  chatStream: async () => ({ content: 'should not reach here', toolCalls: null }),
};

const tokenManager = {
  maxIterations: 3,
  tpmLimit: 8000,
  calculateMaxOutputTokens: () => ({ inputTokens: 834, maxOutput: 600, tpmCeiling: 7166, isTooSmall: false, needsCompression: false }),
  acquireRequest: async () => {},
  releaseRequest: () => {},
  estimateMessagesTokens: () => 100,
  estimateTokens: () => 50,
  compressForTpmLimit: (m) => m,
  truncateMessages: (m) => m,
  sleep: async () => {},
};

const conversationManager = {
  getRecentMessages: async () => [{ role: 'user', content: 'What was my last trade?' }],
  getConversationSummary: async () => null,
};

const memoryManager = {
  searchMemories: async () => [],
};

const contextBuilder = {
  classifyIntent: () => 'trading_data',
  buildSystemPrompt: () => 'You are AURA.',
  buildContext: () => [{ role: 'system', content: 'You are AURA.' }],
  getOptimalTools: () => ['get_recent_trades'],
};

const toolRouter = {
  getFilteredToolDefinitions: () => [],
};

const agent = new AuraAgent({
  tokenManager,
  memoryManager,
  toolRouter,
  contextBuilder,
  conversationManager,
});
// Override with the failing client to exercise the catch path
agent.groq = failingGroq;

const thinking = [];
const result = await agent.run({
  userId: 'test-user',
  conversationId: 'test-conv',
  userMessage: 'What was my last trade?',
  onThinking: (info) => thinking.push(info),
});

// The run() should NOT have thrown — it should return the fallback content
// because every Groq call failed (after retries exhausted on iteration 1)
// OR it should have returned gracefully.
console.log('RESULT returned without crash.');
console.log('  content:', JSON.stringify(result.content).slice(0, 120) + '...');
console.log('  reasoningMode:', result.reasoningMode);
console.log('  metrics:', JSON.stringify(result.metrics));
console.log('  rateLimited:', result.metrics.rateLimited);

// The key verification: the catch block executed without ReferenceError.
const hasRateLimitThinking = thinking.some((t) => t.message && t.message.includes('Rate limit'));
console.log('  catch-block rate-limit handling executed:', hasRateLimitThinking ? 'YES' : 'NO');

if (!hasRateLimitThinking) {
  console.error('FAIL: rate-limit catch path did not execute as expected');
  process.exit(1);
}
if (typeof result.metrics.modelLatencyMs !== 'number') {
  console.error('FAIL: modelLatencyMs metric missing');
  process.exit(1);
}
console.log('PASS: catch-block metrics code executes without ReferenceError');