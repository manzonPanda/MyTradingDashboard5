/**
 * Proactive Event Engine - Deterministic event detection
 *
 * Uses deterministic rules first (no LLM) to detect significant events.
 * Only calls Groq when an event is deemed significant and needs
 * a natural-language notification.
 *
 * Examples:
 *   - Daily target reached
 *   - Daily loss limit approaching
 *   - Unusual position size
 *   - Consecutive losses
 *   - Overtrading detected
 *   - Large drawdown
 *   - Repeated rule violation
 *   - End of trading session
 *   - Weekly review available
 */

export class ProactiveEngine {
  constructor(supabase) {
    this.supabase = supabase;
  }

  /**
   * Detect significant events using deterministic rules.
   * No LLM is used here — this is pure backend logic.
   */
  async detectEvents(userId) {
    const events = [];

    try {
      const [trades, settings, accounts] = await Promise.all([
        this.getTodayTrades(userId),
        this.getUserSettings(userId),
        this.getUserAccounts(userId),
      ]);

      // 1. Daily target reached
      const dailyPnl = this.calculateDailyPnl(trades);
      const dailyTarget = settings?.daily_target_percent;
      if (dailyTarget && dailyPnl > 0) {
        events.push({
          type: 'daily_target_reached',
          severity: 'positive',
          title: 'Daily target reached',
          content: `You're up ${dailyPnl.toFixed(2)} today. Consider locking in your gains.`,
          data: { dailyPnl, dailyTarget },
        });
      }

      // 2. Daily loss limit approaching
      const dailyLossLimit = settings?.daily_loss_limit_percent;
      if (dailyLossLimit && dailyPnl < 0) {
        const lossPercent = Math.abs(dailyPnl);
        if (lossPercent >= dailyLossLimit * 0.8) {
          events.push({
            type: 'daily_loss_approaching',
            severity: lossPercent >= dailyLossLimit ? 'critical' : 'warning',
            title: 'Daily loss limit approaching',
            content: `You're down ${lossPercent.toFixed(2)}% today. Your daily loss limit is ${dailyLossLimit}%.`,
            data: { dailyPnl, dailyLossLimit, lossPercent },
          });
        }
      }

      // 3. Consecutive losses
      const consecutiveLosses = this.countConsecutiveLosses(trades);
      if (consecutiveLosses >= 3) {
        events.push({
          type: 'consecutive_losses',
          severity: consecutiveLosses >= 5 ? 'critical' : 'warning',
          title: `${consecutiveLosses} consecutive losses`,
          content: `You've had ${consecutiveLosses} losses in a row. Consider stepping back and reviewing your approach.`,
          data: { consecutiveLosses },
        });
      }

      // 4. Overtrading detection
      const todayTradeCount = trades.length;
      if (todayTradeCount >= 10) {
        events.push({
          type: 'overtrading_detected',
          severity: 'warning',
          title: 'Overtrading detected',
          content: `You've taken ${todayTradeCount} trades today. This may indicate overtrading.`,
          data: { todayTradeCount },
        });
      }

      // 5. Large drawdown
      const maxDrawdown = this.calculateMaxDrawdown(trades);
      if (maxDrawdown > 0) {
        const maxDrawdownPercent = accounts[0]?.max_total_drawdown_percent;
        if (maxDrawdownPercent && maxDrawdown >= maxDrawdownPercent * 0.8) {
          events.push({
            type: 'large_drawdown',
            severity: maxDrawdown >= maxDrawdownPercent ? 'critical' : 'warning',
            title: 'Large drawdown detected',
            content: `Your drawdown is at ${maxDrawdown.toFixed(2)}%. Your max drawdown limit is ${maxDrawdownPercent}%.`,
            data: { maxDrawdown, maxDrawdownPercent },
          });
        }
      }

      // 6. Repeated rule violations
      const ruleViolations = this.countRuleViolations(trades);
      if (ruleViolations >= 3) {
        events.push({
          type: 'repeated_rule_violation',
          severity: 'warning',
          title: 'Repeated rule violations',
          content: `You've violated trading rules ${ruleViolations} times today. Review your discipline.`,
          data: { ruleViolations },
        });
      }

      // 7. Weekly review available
      if (this.isEndOfWeek()) {
        const weeklyTrades = await this.getThisWeekTrades(userId);
        if (weeklyTrades.length > 0) {
          events.push({
            type: 'weekly_review_available',
            severity: 'info',
            title: 'Weekly review available',
            content: `You have ${weeklyTrades.length} trades this week. Ask AURA for a weekly review.`,
            data: { weeklyTradeCount: weeklyTrades.length },
          });
        }
      }
    } catch (err) {
      console.error('[Proactive] Event detection failed:', err.message);
    }

    // Save significant events as insights
    for (const event of events) {
      if (event.severity === 'critical' || event.severity === 'positive') {
        await this.saveInsight(userId, event);
      }
    }

    return events;
  }

  async getTodayTrades(userId) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data, error } = await this.supabase
      .from('trades')
      .select('pnl, time_open, time_close, rules_violated, instrument, buy_sell')
      .gte('time_open', todayStart.toISOString())
      .order('time_open', { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);
    return data || [];
  }

  async getThisWeekTrades(userId) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const { data, error } = await this.supabase
      .from('trades')
      .select('pnl, time_open, time_close')
      .gte('time_open', weekStart.toISOString())
      .order('time_open', { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    return data || [];
  }

  async getUserSettings(userId) {
    const { data, error } = await this.supabase
      .from('user_settings')
      .select('daily_target_percent, daily_loss_limit_percent, weekly_r_target')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async getUserAccounts(userId) {
    const { data, error } = await this.supabase
      .from('accounts')
      .select('max_total_drawdown_percent, daily_loss_limit_percent, initial_balance')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);
    return data || [];
  }

  calculateDailyPnl(trades) {
    return trades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  }

  countConsecutiveLosses(trades) {
    let count = 0;
    for (const trade of trades) {
      if (Number(trade.pnl) < 0) count++;
      else break;
    }
    return count;
  }

  calculateMaxDrawdown(trades) {
    let peak = 0;
    let maxDrawdown = 0;
    let runningPnl = 0;

    for (const trade of [...trades].reverse()) {
      runningPnl += Number(trade.pnl) || 0;
      if (runningPnl > peak) peak = runningPnl;
      const drawdown = peak - runningPnl;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return maxDrawdown;
  }

  countRuleViolations(trades) {
    return trades.filter((t) => t.rules_violated && t.rules_violated.trim()).length;
  }

  isEndOfWeek() {
    const day = new Date().getDay();
    return day === 5 || day === 6; // Friday or Saturday
  }

  async saveInsight(userId, event) {
    try {
      const { error } = await this.supabase
        .from('ai_insights')
        .insert({
          user_id: userId,
          insight_type: 'proactive_alert',
          title: event.title,
          content: event.content,
          severity: event.severity,
          related_data: event.data,
        });

      if (error) console.warn('[Proactive] Save insight failed:', error.message);
    } catch (err) {
      console.warn('[Proactive] Save insight error:', err.message);
    }
  }

  async getInsights(userId) {
    const { data, error } = await this.supabase
      .from('ai_insights')
      .select('id, insight_type, title, content, severity, is_read, is_dismissed, created_at')
      .eq('user_id', userId)
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw new Error(error.message);
    return data || [];
  }

  async markInsightRead(insightId, userId) {
    const { error } = await this.supabase
      .from('ai_insights')
      .update({ is_read: true })
      .eq('id', insightId)
      .eq('user_id', userId);

    if (error) throw new Error(error.message);
  }

  async dismissInsight(insightId, userId) {
    const { error } = await this.supabase
      .from('ai_insights')
      .update({ is_dismissed: true })
      .eq('id', insightId)
      .eq('user_id', userId);

    if (error) throw new Error(error.message);
  }
}