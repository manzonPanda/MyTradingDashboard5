/**
 * Tool Router - Controlled backend tools
 *
 * The LLM does NOT directly access Supabase.
 * Instead, Groq makes tool calls → Backend tool → Supabase → Compact result → Groq.
 *
 * Each tool:
 *   - Validates input
 *   - Verifies authenticated user_id
 *   - Applies Supabase RLS/security
 *   - Queries only required data
 *   - Limits returned records
 *   - Returns compact structured results
 *
 * SAFETY: All tools are READ-ONLY regarding trading accounts.
 *         No trade placement, modification, or withdrawal.
 */

import { TradingDataAccess, AccountAccessError } from './data/trading-data.js';

export class ToolRouter {
  constructor(supabase, tradingData = null) {
    this.supabase = supabase;
    // SECURITY: every trade query is scoped through TradingDataAccess.
    // `trades` has no user_id column — ownership is trades.account_id →
    // accounts.user_id, so queries must be filtered by the authenticated
    // user's account ids. Unscoped trade queries are a cross-user data leak.
    this.tradingData = tradingData || new TradingDataAccess(supabase);

    // Tool definitions exposed to the LLM
    this.toolDefinitions = [
      {
        type: 'function',
        function: {
          name: 'get_recent_trades',
          description: 'Get the user\'s most recent trades. Use for questions about recent trading activity.',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'integer', description: 'Number of trades to return (max 20)', default: 10 },
              symbol: { type: 'string', description: 'Filter by instrument/symbol (e.g., "DAX", "EURUSD")' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_open_trades',
          description: 'Get currently open/active trades (trades without a close time).',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_trade',
          description: 'Get a specific trade by its ticket number.',
          parameters: {
            type: 'object',
            properties: {
              ticket: { type: ['integer', 'string'], description: 'The trade ticket number' },
            },
            required: ['ticket'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_performance_summary',
          description: 'Get overall trading performance summary including total P&L, win rate, profit factor, and R-multiple.',
          parameters: {
            type: 'object',
            properties: {
              days: { type: 'integer', description: 'Lookback period in days (default 30)', default: 30 },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_strategy_statistics',
          description: 'Get statistics grouped by trading strategy. Use for questions about which strategies perform best.',
          parameters: {
            type: 'object',
            properties: {
              days: { type: 'integer', description: 'Lookback period in days', default: 30 },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_risk_metrics',
          description: 'Get risk metrics including max drawdown, average risk per trade, and risk-reward ratios.',
          parameters: {
            type: 'object',
            properties: {
              days: { type: 'integer', description: 'Lookback period in days', default: 30 },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_session_statistics',
          description: 'Get trading statistics by session (London, New York, Tokyo, Sydney). Use for questions about which sessions the user performs best in.',
          parameters: {
            type: 'object',
            properties: {
              days: { type: 'integer', description: 'Lookback period in days', default: 30 },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_symbol_statistics',
          description: 'Get statistics for a specific trading instrument/symbol. Use for questions like "Why am I losing on DAX?" or "What\'s my EURUSD win rate?"',
          parameters: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'The instrument symbol (e.g., "DAX", "EURUSD", "XAUUSD")' },
              days: { type: 'integer', description: 'Lookback period in days', default: 30 },
            },
            required: ['symbol'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_trading_rules',
          description: 'Get the user\'s trading rules and settings (daily target, max drawdown, etc.).',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_journal_entries',
          description: 'Get the user\'s trade journal entries (daily reflections and weekly retrospectives).',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'integer', description: 'Number of entries to return (max 20)', default: 10 },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_roi_summary',
          description: 'Get ROI/payout summary including total invested, total returned, and net ROI.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_memories',
          description: 'Search the user\'s long-term semantic memories. Use for questions about preferences, rules, goals, strategies, or past discussions about trading psychology.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The search query' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'save_memory',
          description: 'Save a durable memory for the user. Use when the user explicitly asks to remember something, or when a clear preference/rule/goal is stated.',
          parameters: {
            type: 'object',
            properties: {
              memory: { type: 'string', description: 'The memory text to save' },
              memory_type: {
                type: 'string',
                enum: ['preference', 'trading_rule', 'behavior', 'goal', 'fact', 'strategy', 'insight'],
                description: 'The type of memory',
              },
              importance: { type: 'integer', description: 'Importance 1-10 (default 5)', default: 5 },
            },
            required: ['memory', 'memory_type'],
          },
        },
      },
    ];
  }

  getToolDefinitions() {
    return this.toolDefinitions;
  }

  /**
   * Get a FILTERED subset of tool definitions by tool name.
   * Used to reduce input tokens: for a simple "what was my last trade?" question
   * we only need get_recent_trades + get_trade (~80 tokens) instead of all 13
   * tools (~700 tokens). Always includes save_memory + search_memories so the
   * model can still save/search memories if needed.
   *
   * @param {string[]} suggestedToolNames - Tool names to include.
   * @returns {object[]} Filtered tool definitions.
   */
  getFilteredToolDefinitions(suggestedToolNames = []) {
    if (!suggestedToolNames || suggestedToolNames.length === 0) {
      return this.toolDefinitions;
    }
    // Always allow memory tools so the model can search/save if needed
    const allow = new Set([...suggestedToolNames, 'search_memories', 'save_memory']);
    return this.toolDefinitions.filter((td) => allow.has(td.function.name));
  }

  /**
   * Execute a tool call. All tools verify user_id. When a specific trading
   * account is requested, its ownership is verified BEFORE any query runs.
   */
  async executeTool(toolName, args, userId, memoryManager, { accountId = null } = {}) {
    const handler = this[`tool_${toolName}`];
    if (!handler) {
      return { error: `Unknown tool: ${toolName}` };
    }

    if (accountId) {
      try {
        await this.tradingData.assertAccountOwnership(userId, accountId);
      } catch (err) {
        if (err instanceof AccountAccessError) {
          return { error: 'The requested trading account does not belong to you.' };
        }
        throw err;
      }
    }

    try {
      return await handler.call(this, args, userId, memoryManager, { accountId });
    } catch (err) {
      console.error(`[Tool] ${toolName} failed:`, err.message);
      return { error: `Tool ${toolName} failed: ${err.message}` };
    }
  }

  // ─── Tool: get_recent_trades ──────────────────────────────────
  async tool_get_recent_trades(args, userId, _memoryManager, { accountId = null } = {}) {
    const { limit = 10, symbol } = args;
    const maxLimit = Math.min(limit, 20);

    const accountIds = await this.tradingData.resolveAccountScope(userId, accountId);
    if (accountIds.length === 0) return { trades: [], count: 0 };

    let query = this.supabase
      .from('trades')
      .select('ticket, instrument, buy_sell, lots, pnl, commission, swap, time_open, time_close, rrr, risk_per_trade, daily_reflection, rules_violated')
      .in('account_id', accountIds)
      .order('time_open', { ascending: false })
      .limit(maxLimit);

    if (symbol) {
      query = query.ilike('instrument', `%${symbol}%`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return { trades: data || [], count: data?.length || 0 };
  }

  // ─── Tool: get_open_trades ────────────────────────────────────
  async tool_get_open_trades(_args, userId, _memoryManager, { accountId = null } = {}) {
    const accountIds = await this.tradingData.resolveAccountScope(userId, accountId);
    if (accountIds.length === 0) return { openTrades: [], count: 0 };

    const { data, error } = await this.supabase
      .from('trades')
      .select('ticket, instrument, buy_sell, lots, pnl, time_open, price_open, sl, tp')
      .in('account_id', accountIds)
      .is('time_close', null)
      .order('time_open', { ascending: false })
      .limit(20);

    if (error) throw new Error(error.message);

    return { openTrades: data || [], count: data?.length || 0 };
  }

  // ─── Tool: get_trade ──────────────────────────────────────────
  async tool_get_trade(args, userId, _memoryManager, { accountId = null } = {}) {
    const { ticket } = args;
    if (!ticket) return { error: 'Ticket is required' };

    // SECURITY: ticket is globally unique, so it MUST be scoped to the
    // authenticated user's accounts — otherwise any user could read any
    // other user's trade by guessing tickets.
    const accountIds = await this.tradingData.resolveAccountScope(userId, accountId);
    if (accountIds.length === 0) return { error: `Trade with ticket ${ticket} not found` };

    const { data, error } = await this.supabase
      .from('trades')
      .select('*')
      .eq('ticket', ticket)
      .in('account_id', accountIds)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return { error: `Trade with ticket ${ticket} not found` };

    return { trade: data };
  }

  // ─── Tool: get_performance_summary ────────────────────────────
  async tool_get_performance_summary(args, userId, _memoryManager, { accountId = null } = {}) {
    const { days = 30 } = args;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const accountIds = await this.tradingData.resolveAccountScope(userId, accountId);
    if (accountIds.length === 0) return { summary: { message: 'No trading accounts available.' } };

    const { data, error } = await this.supabase
      .from('trades')
      .select('pnl, commission, swap, rrr, risk_per_trade, buy_sell, time_open, time_close')
      .in('account_id', accountIds)
      .gte('time_open', since)
      .not('time_close', 'is', null)
      .order('time_open', { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const trades = data || [];
    if (trades.length === 0) return { summary: { message: 'No closed trades in the selected period.' } };

    const totalPnl = trades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    const totalCommission = trades.reduce((sum, t) => sum + (Number(t.commission) || 0), 0);
    const totalSwap = trades.reduce((sum, t) => sum + (Number(t.swap) || 0), 0);
    const netPnl = totalPnl + totalCommission + totalSwap;

    const wins = trades.filter((t) => Number(t.pnl) > 0);
    const losses = trades.filter((t) => Number(t.pnl) < 0);
    const grossWin = wins.reduce((sum, t) => sum + Number(t.pnl), 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + Number(t.pnl), 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
    const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

    // R-multiple calculation
    const tradesWithRisk = trades.filter((t) => t.risk_per_trade && Number(t.risk_per_trade) > 0);
    const totalR = tradesWithRisk.reduce((sum, t) => {
      const r = Number(t.risk_per_trade);
      return sum + (Number(t.pnl) || 0) / r;
    }, 0);

    return {
      summary: {
        period: `${days} days`,
        totalTrades: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: winRate.toFixed(1) + '%',
        grossPnl: totalPnl.toFixed(2),
        commission: totalCommission.toFixed(2),
        swap: totalSwap.toFixed(2),
        netPnl: netPnl.toFixed(2),
        profitFactor: profitFactor.toFixed(2),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        totalR: totalR.toFixed(2),
        expectancy: trades.length > 0 ? (netPnl / trades.length).toFixed(2) : '0',
      },
    };
  }

  // ─── Tool: get_strategy_statistics ────────────────────────────
  async tool_get_strategy_statistics(args, userId, _memoryManager, { accountId = null } = {}) {
    const { days = 30 } = args;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const accountIds = await this.tradingData.resolveAccountScope(userId, accountId);
    if (accountIds.length === 0) return { strategies: [] };

    const { data, error } = await this.supabase
      .from('trades')
      .select('pnl, rrr, time_open')
      .in('account_id', accountIds)
      .gte('time_open', since)
      .not('time_close', 'is', null)
      .not('rrr', 'is', null)
      .order('time_open', { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const trades = data || [];
    const byStrategy = {};

    for (const trade of trades) {
      const strategy = trade.rrr || 'Unknown';
      if (!byStrategy[strategy]) {
        byStrategy[strategy] = { trades: 0, wins: 0, losses: 0, pnl: 0 };
      }
      byStrategy[strategy].trades++;
      byStrategy[strategy].pnl += Number(trade.pnl) || 0;
      if (Number(trade.pnl) > 0) byStrategy[strategy].wins++;
      else if (Number(trade.pnl) < 0) byStrategy[strategy].losses++;
    }

    const result = Object.entries(byStrategy).map(([strategy, stats]) => ({
      strategy,
      trades: stats.trades,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.trades > 0 ? ((stats.wins / stats.trades) * 100).toFixed(1) + '%' : '0%',
      netPnl: stats.pnl.toFixed(2),
    }));

    return { strategies: result };
  }

  // ─── Tool: get_risk_metrics ────────────────────────────────────
  async tool_get_risk_metrics(args, userId, _memoryManager, { accountId = null } = {}) {
    const { days = 30 } = args;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const accountIds = await this.tradingData.resolveAccountScope(userId, accountId);
    if (accountIds.length === 0) return { riskMetrics: { message: 'No trading accounts available.' } };

    const { data, error } = await this.supabase
      .from('trades')
      .select('pnl, risk_per_trade, rrr, time_open, time_close')
      .in('account_id', accountIds)
      .gte('time_open', since)
      .not('time_close', 'is', null)
      .order('time_open', { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const trades = data || [];
    if (trades.length === 0) return { riskMetrics: { message: 'No trades in the selected period.' } };

    // Calculate drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let runningPnl = 0;

    for (const trade of [...trades].reverse()) {
      runningPnl += Number(trade.pnl) || 0;
      if (runningPnl > peak) peak = runningPnl;
      const drawdown = peak - runningPnl;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    const tradesWithRisk = trades.filter((t) => t.risk_per_trade && Number(t.risk_per_trade) > 0);
    const avgRisk = tradesWithRisk.length > 0
      ? tradesWithRisk.reduce((sum, t) => sum + Number(t.risk_per_trade), 0) / tradesWithRisk.length
      : 0;

    const rMultiples = tradesWithRisk.map((t) => Number(t.pnl) / Number(t.risk_per_trade));
    const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;

    return {
      riskMetrics: {
        period: `${days} days`,
        totalTrades: trades.length,
        maxDrawdown: maxDrawdown.toFixed(2),
        avgRiskPerTrade: avgRisk.toFixed(2),
        avgRMultiple: avgR.toFixed(2),
        bestR: rMultiples.length > 0 ? Math.max(...rMultiples).toFixed(2) : '0',
        worstR: rMultiples.length > 0 ? Math.min(...rMultiples).toFixed(2) : '0',
      },
    };
  }

  // ─── Tool: get_session_statistics ──────────────────────────────
  async tool_get_session_statistics(args, userId, _memoryManager, { accountId = null } = {}) {
    const { days = 30 } = args;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const accountIds = await this.tradingData.resolveAccountScope(userId, accountId);
    if (accountIds.length === 0) return { sessions: [] };

    const { data, error } = await this.supabase
      .from('trades')
      .select('pnl, time_open, instrument')
      .in('account_id', accountIds)
      .gte('time_open', since)
      .not('time_close', 'is', null)
      .order('time_open', { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const trades = data || [];
    const sessions = {
      London: { trades: 0, wins: 0, pnl: 0 },
      'New York': { trades: 0, wins: 0, pnl: 0 },
      Tokyo: { trades: 0, wins: 0, pnl: 0 },
      Sydney: { trades: 0, wins: 0, pnl: 0 },
      Other: { trades: 0, wins: 0, pnl: 0 },
    };

    for (const trade of trades) {
      const hour = new Date(trade.time_open).getUTCHours();
      let session = 'Other';
      if (hour >= 7 && hour < 16) session = 'London';
      else if (hour >= 12 && hour < 21) session = 'New York';
      else if (hour >= 0 && hour < 9) session = 'Tokyo';
      else if (hour >= 21 || hour < 6) session = 'Sydney';

      sessions[session].trades++;
      sessions[session].pnl += Number(trade.pnl) || 0;
      if (Number(trade.pnl) > 0) sessions[session].wins++;
    }

    const result = Object.entries(sessions)
      .filter(([_, s]) => s.trades > 0)
      .map(([session, s]) => ({
        session,
        trades: s.trades,
        wins: s.wins,
        winRate: s.trades > 0 ? ((s.wins / s.trades) * 100).toFixed(1) + '%' : '0%',
        netPnl: s.pnl.toFixed(2),
      }));

    return { sessions: result };
  }

  // ─── Tool: get_symbol_statistics ───────────────────────────────
  async tool_get_symbol_statistics(args, userId, _memoryManager, { accountId = null } = {}) {
    const { symbol, days = 30 } = args;
    if (!symbol) return { error: 'Symbol is required' };

    const since = new Date(Date.now() - days * 86400000).toISOString();

    const accountIds = await this.tradingData.resolveAccountScope(userId, accountId);
    if (accountIds.length === 0) return { symbolStats: { message: `No trades found for ${symbol} in the last ${days} days.` } };

    const { data, error } = await this.supabase
      .from('trades')
      .select('pnl, commission, swap, buy_sell, lots, time_open, time_close, rrr, risk_per_trade, rules_violated')
      .in('account_id', accountIds)
      .ilike('instrument', `%${symbol}%`)
      .gte('time_open', since)
      .not('time_close', 'is', null)
      .order('time_open', { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);

    const trades = data || [];
    if (trades.length === 0) return { symbolStats: { message: `No trades found for ${symbol} in the last ${days} days.` } };

    const wins = trades.filter((t) => Number(t.pnl) > 0);
    const losses = trades.filter((t) => Number(t.pnl) < 0);
    const totalPnl = trades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    const totalCommission = trades.reduce((sum, t) => sum + (Number(t.commission) || 0), 0);

    const tradesWithRisk = trades.filter((t) => t.risk_per_trade && Number(t.risk_per_trade) > 0);
    const totalR = tradesWithRisk.reduce((sum, t) => sum + (Number(t.pnl) || 0) / Number(t.risk_per_trade), 0);

    // Check for rule violations
    const ruleViolations = trades
      .filter((t) => t.rules_violated && t.rules_violated.trim())
      .map((t) => t.rules_violated);

    return {
      symbolStats: {
        symbol,
        period: `${days} days`,
        totalTrades: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: trades.length > 0 ? ((wins.length / trades.length) * 100).toFixed(1) + '%' : '0%',
        netPnl: (totalPnl + totalCommission).toFixed(2),
        totalR: totalR.toFixed(2),
        avgR: tradesWithRisk.length > 0 ? (totalR / tradesWithRisk.length).toFixed(2) : '0',
        ruleViolations: ruleViolations.length > 0 ? ruleViolations : null,
        buyCount: trades.filter((t) => t.buy_sell === 'Buy').length,
        sellCount: trades.filter((t) => t.buy_sell === 'Sell').length,
      },
    };
  }

  // ─── Tool: get_trading_rules ───────────────────────────────────
  async tool_get_trading_rules(_args, userId) {
    const { data: settings, error: settingsError } = await this.supabase
      .from('user_settings')
      .select('daily_target_percent, weekly_r_target, trading_day_reset_time')
      .eq('user_id', userId)
      .maybeSingle();

    if (settingsError) throw new Error(settingsError.message);

    const { data: accounts, error: accountsError } = await this.supabase
      .from('accounts')
      .select('name, initial_balance, profit_target_percent, max_total_drawdown_percent, daily_loss_limit_percent, phase, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (accountsError) throw new Error(accountsError.message);

    return {
      rules: {
        dailyTargetPercent: settings?.daily_target_percent || null,
        weeklyRTarget: settings?.weekly_r_target || null,
        tradingDayResetTime: settings?.trading_day_reset_time || null,
        accounts: accounts || [],
      },
    };
  }

  // ─── Tool: get_journal_entries ─────────────────────────────────
  async tool_get_journal_entries(args, userId, _memoryManager, { accountId = null } = {}) {
    const { limit = 10 } = args;
    const maxLimit = Math.min(limit, 20);

    const accountIds = await this.tradingData.resolveAccountScope(userId, accountId);
    if (accountIds.length === 0) return { journalEntries: [], count: 0 };

    const { data, error } = await this.supabase
      .from('trades')
      .select('ticket, instrument, time_open, daily_reflection, weekly_retrospective, pnl, rules_violated')
      .in('account_id', accountIds)
      .not('daily_reflection', 'eq', '')
      .order('time_open', { ascending: false })
      .limit(maxLimit);

    if (error) throw new Error(error.message);

    return { journalEntries: data || [], count: data?.length || 0 };
  }

  // ─── Tool: get_roi_summary ─────────────────────────────────────
  async tool_get_roi_summary(_args, userId) {
    const { data: transactions, error: txError } = await this.supabase
      .from('roi_transactions')
      .select('transaction_type, amount, transaction_date')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false })
      .limit(100);

    if (txError) throw new Error(txError.message);

    const { data: payouts, error: payoutError } = await this.supabase
      .from('payouts')
      .select('amount, payout_date')
      .eq('user_id', userId)
      .order('payout_date', { ascending: false })
      .limit(50);

    if (payoutError) throw new Error(payoutError.message);

    const totalExpenses = (transactions || [])
      .filter((t) => t.transaction_type === 'expense')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalPayouts = (transactions || [])
      .filter((t) => t.transaction_type === 'payout')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalPayoutAmount = (payouts || []).reduce((sum, p) => sum + Number(p.amount), 0);

    return {
      roiSummary: {
        totalExpenses: totalExpenses.toFixed(2),
        totalPayouts: totalPayouts.toFixed(2),
        totalPayoutAmount: totalPayoutAmount.toFixed(2),
        netRoi: totalExpenses > 0 ? (((totalPayouts + totalPayoutAmount - totalExpenses) / totalExpenses) * 100).toFixed(2) + '%' : '0%',
        transactionCount: transactions?.length || 0,
        payoutCount: payouts?.length || 0,
      },
    };
  }

  // ─── Tool: search_memories ─────────────────────────────────────
  async tool_search_memories(args, userId, memoryManager) {
    const { query } = args;
    if (!query) return { error: 'Query is required' };

    const memories = await memoryManager.searchMemories(userId, query, 5);
    return { memories, count: memories.length };
  }

  // ─── Tool: save_memory ─────────────────────────────────────────
  async tool_save_memory(args, userId, memoryManager) {
    const { memory, memory_type, importance } = args;
    if (!memory) return { error: 'Memory text is required' };

    const saved = await memoryManager.saveMemory(userId, {
      memory,
      memoryType: memory_type || 'fact',
      importance: importance || 5,
      source: 'tool_call',
    });

    return { saved: true, memory: saved };
  }
}