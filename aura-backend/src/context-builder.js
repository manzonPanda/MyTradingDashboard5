/**
 * Context Builder - Token-budgeted context assembly
 *
 * For every user message:
 *   1. Intent / task classification
 *   2. Retrieve only relevant context
 *   3. Assemble: system prompt + summary + recent messages + memories + tool data
 *   4. Token budget check
 *
 * The LLM receives ONLY the context necessary to answer the question.
 */

/**
 * Recursively strip null/undefined/empty values from a tool result object.
 * This dramatically reduces input tokens: e.g. a trade row with 8 null fields
 * goes from ~50 tokens to ~20 tokens. All meaningful data is preserved.
 */
export function compactToolResult(obj) {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    const compacted = obj.map(compactToolResult).filter((v) => v !== null && v !== undefined);
    return compacted.length > 0 ? compacted : null;
  }
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const compacted = compactToolResult(value);
      if (compacted !== null && compacted !== undefined && compacted !== '') {
        result[key] = compacted;
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }
  // Primitives: return as-is (empty string is filtered by the caller)
  return obj === '' ? null : obj;
}

export class ContextBuilder {
  constructor(tokenManager) {
    this.tokenManager = tokenManager;
  }

  /**
   * Build the system prompt for AURA.
   * Defines the AI's persona, capabilities, and constraints.
   */
  buildSystemPrompt(userPreferences = {}, accountContext = null) {
    const concisenessHint = userPreferences.prefersConcise
      ? 'The user prefers concise, direct responses.'
      : 'Be thorough but clear in your responses.';

    // Account context — when the user has selected a specific trading account,
    // every data tool is scoped to it. The model must treat that account as
    // the exclusive subject of the conversation and never mix accounts.
    const accountSection = accountContext?.name
      ? `\n## Active Account\nThe user is currently analyzing the trading account "${accountContext.name}"${
          accountContext.platform ? ` (${accountContext.platform})` : ''
        }. ALL trading data you retrieve is scoped to THIS account only. Never reference or mix data from the user's other accounts.`
      : '';

    return `You are AURA (Agentic Unified Retail Assistant), a personal agentic trading assistant.

## Your Role
You are an analysis, coaching, and information assistant. You help traders understand their performance, identify patterns, and improve their decision-making.
${accountSection}
## Capabilities
- You can retrieve and analyze the user's trading data using tools
- You can search the user's long-term memories for context
- You can save important information as durable memories
- You provide personalized coaching based on the user's trading history

## Guidelines
- ${concisenessHint}
- When asked about specific trading data (P&L, win rate, trades), ALWAYS use the appropriate tool rather than guessing
- When asked about preferences, rules, or past discussions, use search_memories
- Challenge questionable trading decisions when appropriate — the user values honest feedback
- Use R-multiples when discussing performance (e.g., "+2.4R")
- Reference specific trades by ticket number when relevant
- If you don't have enough data, say so honestly rather than making assumptions

## Safety Constraints
- You are READ-ONLY regarding trading accounts
- Never suggest placing, modifying, or closing trades
- Never suggest withdrawing funds or changing account settings
- Focus on analysis, coaching, and information

## Response Format
- Use Markdown for formatting
- Use bullet points for lists
- Use **bold** for key metrics
- Use code blocks for data tables when appropriate
- Keep responses focused and actionable`;
  }

  /**
   * Classify the user's intent to determine what context to retrieve.
   */
  classifyIntent(message) {
    const lower = message.toLowerCase();

    // Trading-data question
    if (/(how much|how many|what.*win rate|what.*pnl|what.*profit|performance|drawdown|risk|trade.*yesterday|trade.*today|trade.*this week|trade.*this month|last trade|my trade|open trade|open position|balance|payout|roi|current.*drawdown)/.test(lower)) {
      return 'trading_data';
    }

    // Memory question
    if (/(what did i say|what have i told you|have we discussed|remember when|my strategy|my psychology|my rules|my goals|my preferences|what do you know about)/.test(lower)) {
      return 'memory';
    }

    // Analysis question
    if (/(why am i losing|why.*struggling|analyze|pattern|behavior|overtrading|revenge trading|tilt|improve|what.*wrong|what.*should i)/.test(lower)) {
      return 'analysis';
    }

    // Action request (save memory)
    if (/(remember this|save this|note that|don't forget|keep in mind)/.test(lower)) {
      return 'action';
    }

    // Default: conversation
    return 'conversation';
  }

  /**
   * Build the full context for a Groq request.
   *
   * Context = System Prompt + Conversation Summary + Recent Messages + Relevant Memories + Tool Results
   *
   * Tool results are compacted: null/empty fields are stripped before
   * serialization to save input tokens (e.g. a trade with 8 null fields goes
   * from ~50 to ~20 tokens). This preserves all meaningful data while cutting
   * noise that the LLM doesn't need.
   */
  buildContext({
    systemPrompt,
    conversationSummary,
    recentMessages,
    relevantMemories,
    toolResults,
  }) {
    const context = [];

    // 1. System prompt
    context.push({ role: 'system', content: systemPrompt });

    // 2. Conversation summary (context compression)
    if (conversationSummary) {
      context.push({
        role: 'system',
        content: `Previous conversation summary: ${conversationSummary}`,
      });
    }

    // 3. Relevant memories
    if (relevantMemories && relevantMemories.length > 0) {
      const memoryText = relevantMemories
        .map((m) => `- [${m.memory_type}] ${m.memory}`)
        .join('\n');
      context.push({
        role: 'system',
        content: `Relevant long-term memories about the user:\n${memoryText}`,
      });
    }

    // 4. Tool results (from previous iterations) — compacted
    if (toolResults && toolResults.length > 0) {
      for (const result of toolResults) {
        context.push({
          role: 'tool',
          content: JSON.stringify(compactToolResult(result.result)),
          name: result.toolName,
        });
      }
    }

    // 5. Recent conversation messages (working memory)
    for (const msg of recentMessages) {
      context.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // 6. Truncate to fit token budget
    return this.tokenManager.truncateMessages(context);
  }

  /**
   * Determine which tools might be needed based on intent classification.
   * This is a hint, not a restriction — the LLM makes the final decision.
   */
  suggestToolsForIntent(intent) {
    const toolMap = {
      trading_data: [
        'get_performance_summary',
        'get_recent_trades',
        'get_symbol_statistics',
        'get_risk_metrics',
        'get_session_statistics',
        'get_strategy_statistics',
        'get_roi_summary',
        'get_trading_rules',
        'get_journal_entries',
      ],
      memory: ['search_memories'],
      analysis: [
        'get_performance_summary',
        'get_symbol_statistics',
        'get_session_statistics',
        'get_risk_metrics',
        'get_recent_trades',
        'search_memories',
        'get_journal_entries',
      ],
      action: ['save_memory', 'search_memories'],
      conversation: [],
    };

    return toolMap[intent] || [];
  }

  /**
   * Get the OPTIMAL tool set for a request, considering BOTH intent and
   * complexity level. For SIMPLE questions we send only the most essential
   * tools (saving ~650 input tokens per iteration); for ANALYSIS/DEEP_ANALYSIS
   * we send the full intent-mapped set.
   *
   * This is the key input-token optimization: "What was my last trade?" needs
   * only get_recent_trades + get_trade (~200 tokens of tool defs), not all 13
   * tools (~1050 tokens). Memory tools are always included.
   */
  getOptimalTools(intent, level) {
    if (level === 'SIMPLE') {
      // Narrow tool set for simple factual lookups
      const simpleMap = {
        trading_data: ['get_recent_trades', 'get_trade', 'get_open_trades'],
        memory: ['search_memories'],
        analysis: ['get_performance_summary', 'get_recent_trades'],
        action: ['save_memory', 'search_memories'],
        conversation: [],
      };
      return simpleMap[intent] || [];
    }
    // ANALYSIS / DEEP_ANALYSIS: use the full intent-mapped set
    return this.suggestToolsForIntent(intent);
  }
}