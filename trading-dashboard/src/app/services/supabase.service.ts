import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export interface PropFirm {
  id: string;
  name: string;
  logo_url?: string | null;
  website_url?: string | null;
  created_at?: string;
}

export interface Account {
  id: string;
  name: string;
  prop_firm_id?: string | null;
  account_number?: string | null;
  initial_balance?: number | null;
  profit_target_percent?: number | null;
  max_total_drawdown_percent?: number | null;
  daily_loss_limit_percent?: number | null;
  start_date?: string | null;
  status?: string | null;
  phase?: 'phase1' | 'phase2' | 'funded' | null;
  created_at?: string;
  updated_at?: string;
}

export interface RoiTransaction {
  id: string;
  transaction_date: string;
  transaction_type: 'expense' | 'payout';
  amount: number;
  note?: string | null;
  image_url?: string | null;
  account_id?: string | null;
  user_id?: string | null;
  created_at?: string;
  updated_at?: string;
  accounts?: { name: string } | null;
}

export interface Certificate {
  id: string;
  user_id?: string;
  account_id?: string | null;
  program_name?: string | null;
  passed_date: string;
  status: 'passed' | 'funded' | 'expired';
  file_path?: string | null;
  notes?: string | null;
  created_at?: string;
  payouts?: Payout[];
}

export interface Payout {
  id: string;
  certificate_id?: string | null;
  user_id?: string;
  firm_name: string;
  amount: number;
  payout_date: string;
  notes?: string | null;
  proof_url?: string | null;
  created_at?: string;
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  started_trading_date: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface UserSettings {
  user_id: string;
  per_trade_target_percent: number;
  sound_notifications_threshold: number;
  daily_target_percent: number;
  weekly_r_target: number;
  default_chart_mode: 'daily' | 'trades';
  trading_day_reset_time: string;
  default_account_id: string | null;
  show_account_balance: boolean;
  show_pnl: boolean;
  show_trading_activity: boolean;
  show_news_calendar: boolean;
  aura_enabled: boolean;
  aura_travel_duration_ms: number;
  aura_min_delay_ms: number;
  aura_max_delay_ms: number;
  aura_trail_length_percent: number;
  aura_stroke_width: number;
  aura_head_radius: number;
  aura_bloom_intensity: number;
  aura_fade_duration_ms: number;
  aura_color_start: string;
  aura_color_mid: string;
  aura_color_peak: string;
  aura_color_head: string;
  aura_min_targets: number;
  aura_max_targets: number;
  notifications_enabled: boolean;
  daily_goal_notification: boolean;
  goal_notification_sound: boolean;
  notification_volume: number;
  created_at?: string;
  updated_at?: string;
}

export type AuraEnergySettings = Pick<UserSettings,
  | 'aura_enabled'
  | 'aura_travel_duration_ms'
  | 'aura_min_delay_ms'
  | 'aura_max_delay_ms'
  | 'aura_trail_length_percent'
  | 'aura_stroke_width'
  | 'aura_head_radius'
  | 'aura_bloom_intensity'
  | 'aura_fade_duration_ms'
  | 'aura_color_start'
  | 'aura_color_mid'
  | 'aura_color_peak'
  | 'aura_color_head'
  | 'aura_min_targets'
  | 'aura_max_targets'
>;

export interface Trade {
  id?: string;
  account_id?: string;
  buy_sell?: 'Buy' | 'Sell';
  commission?: number;
  daily_reflection?: string;
  time_open?: string;
  time_close?: string;
  held?: string;
  instrument?: string;
  lots?: number;
  pips?: number;
  pnl?: number;
  rules_violated?: string;
  weekly_retrospective?: string;
  mfe?: number;
  mae?: number;
  mup?: number;
  price_close?: number;
  price_open?: number;
  risk_per_trade?: number;
  rrr?: string;
  sl?: number;
  swap?: number;
  ticket?: number | string;
  tp?: number;
  created_at?: string;
  updated_at?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(
      environment.supabase.url,
      environment.supabase.anonKey
    );
  }

  get client(): SupabaseClient {
    return this.supabase;
  }

  private async getAuthenticatedUserId(): Promise<string> {
    const { data, error } = await this.supabase.auth.getUser();
    if (error || !data.user) throw new Error('You must be signed in to manage accounts.');
    return data.user.id;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw new Error(`Profile loading failed: ${error.message}`);
    return data as Profile | null;
  }

  async updateProfile(userId: string, updates: Pick<Profile, 'display_name' | 'avatar_url' | 'started_trading_date'>): Promise<Profile> {
    const { data, error } = await this.supabase.from('profiles').upsert({ id: userId, ...updates }).select('*').single();
    if (error) throw new Error(`Profile update failed: ${error.message}`);
    return data as Profile;
  }

  async getUserSettings(userId: string): Promise<UserSettings | null> {
    const { data, error } = await this.supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(`Settings loading failed: ${error.message}`);
    return data as UserSettings | null;
  }

  async updateUserSettings(userId: string, updates: Partial<Omit<UserSettings, 'user_id' | 'created_at' | 'updated_at'>>): Promise<UserSettings> {
    const { data, error } = await this.supabase.from('user_settings').upsert({ user_id: userId, ...updates }).select('*').single();
    if (error) throw new Error(`Settings update failed: ${error.message}`);
    return data as UserSettings;
  }

  async getAuraEnergySettings(userId: string): Promise<AuraEnergySettings | null> {
    const { data, error } = await this.supabase
      .from('user_settings')
      .select('aura_enabled, aura_travel_duration_ms, aura_min_delay_ms, aura_max_delay_ms, aura_trail_length_percent, aura_stroke_width, aura_head_radius, aura_bloom_intensity, aura_fade_duration_ms, aura_color_start, aura_color_mid, aura_color_peak, aura_color_head, aura_min_targets, aura_max_targets')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`AURA energy settings loading failed: ${error.message}`);
    return data as AuraEnergySettings | null;
  }

  async updateAuraEnergySettings(userId: string, updates: AuraEnergySettings): Promise<AuraEnergySettings> {
    const { data, error } = await this.supabase
      .from('user_settings')
      .upsert({ user_id: userId, ...updates })
      .select('aura_enabled, aura_travel_duration_ms, aura_min_delay_ms, aura_max_delay_ms, aura_trail_length_percent, aura_stroke_width, aura_head_radius, aura_bloom_intensity, aura_fade_duration_ms, aura_color_start, aura_color_mid, aura_color_peak, aura_color_head, aura_min_targets, aura_max_targets')
      .single();
    if (error) throw new Error(`AURA energy settings update failed: ${error.message}`);
    return data as AuraEnergySettings;
  }

  async getPropFirms(): Promise<PropFirm[]> {
    const { data, error } = await this.supabase
      .from('prop_firms')
      .select('id, name, logo_url, website_url, created_at')
      .order('name', { ascending: true });
    if (error) throw new Error(`Prop firm loading failed: ${error.message}`);
    return (data as PropFirm[]) || [];
  }

  async getAccounts(): Promise<Account[]> {
    const { data, error } = await this.supabase
      .from('accounts')
      .select('id, name, prop_firm_id, account_number, initial_balance, profit_target_percent, max_total_drawdown_percent, daily_loss_limit_percent, start_date, status, phase, created_at')
      .order('created_at', { ascending: false, nullsFirst: false });
    if (error) throw new Error(`Account loading failed: ${error.message}`);
    return (data as Account[]) || [];
  }

  async createAccount(account: Omit<Partial<Account>, 'id' | 'created_at' | 'updated_at'>): Promise<Account> {
    const userId = await this.getAuthenticatedUserId();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    try {
      const { data, error } = await this.supabase
        .from('accounts')
        .insert({ ...account, user_id: userId })
        .select('id, name, prop_firm_id, account_number, initial_balance, profit_target_percent, max_total_drawdown_percent, daily_loss_limit_percent, start_date, status, phase, created_at, updated_at')
        .abortSignal(controller.signal)
        .single();
      if (error) {
        if (controller.signal.aborted) {
          throw new Error('The account request timed out. Check your connection and try again.');
        }
        throw new Error(`Account creation failed: ${error.message}`);
      }
      return data as Account;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('The account request timed out. Check your connection and try again.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async updateAccount(id: string, updates: Omit<Partial<Account>, 'id' | 'created_at' | 'updated_at'>): Promise<Account> {
    const { data, error } = await this.supabase
      .from('accounts')
      .update(updates)
      .eq('id', id)
      .select('id, name, prop_firm_id, account_number, initial_balance, profit_target_percent, max_total_drawdown_percent, daily_loss_limit_percent, start_date, status, phase, created_at, updated_at')
      .single();
    if (error) throw new Error(`Account update failed: ${error.message}`);
    return data as Account;
  }

  async deleteAccount(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('accounts')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`Account deletion failed: ${error.message}`);
  }

  async getCertificates(userId: string): Promise<Certificate[]> {
    const { data, error } = await this.supabase
      .from('certificates')
      .select('*, payouts(*)')
      .eq('user_id', userId)
      .order('passed_date', { ascending: false });
    if (error) throw new Error(`Certificate loading failed: ${error.message}`);
    return (data as Certificate[]) || [];
  }

  async createCertificate(certificate: Omit<Certificate, 'id' | 'user_id' | 'created_at' | 'payouts'>): Promise<Certificate> {
    const userId = await this.getAuthenticatedUserId();
    const { data, error } = await this.supabase
      .from('certificates')
      .insert({ ...certificate, user_id: userId })
      .select('*')
      .single();
    if (error) throw new Error(`Certificate creation failed: ${error.message}`);
    return data as Certificate;
  }

  async updateCertificate(id: string, updates: Omit<Partial<Certificate>, 'id' | 'user_id' | 'created_at' | 'payouts'>): Promise<Certificate> {
    const userId = await this.getAuthenticatedUserId();
    const { data, error } = await this.supabase
      .from('certificates')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) throw new Error(`Certificate update failed: ${error.message}`);
    return data as Certificate;
  }

  async deleteCertificate(id: string): Promise<void> {
    const userId = await this.getAuthenticatedUserId();
    const { error } = await this.supabase
      .from('certificates')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new Error(`Certificate deletion failed: ${error.message}`);
  }

  async createPayout(payout: Omit<Payout, 'id' | 'user_id' | 'created_at'>): Promise<Payout> {
    const userId = await this.getAuthenticatedUserId();
    const { data, error } = await this.supabase
      .from('payouts')
      .insert({ ...payout, user_id: userId })
      .select('*')
      .single();
    if (error) throw new Error(`Payout creation failed: ${error.message}`);
    return data as Payout;
  }

  async uploadCertificateFile(file: File, certificateId: string, firmName: string): Promise<string> {
    const userId = await this.getAuthenticatedUserId();
    const firmFolder = firmName.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'independent-firm';
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const filePath = `${userId}/${firmFolder}/certificates/${Date.now()}-${safeFileName}`;
    const { error: uploadError } = await this.supabase.storage
      .from('certificates')
      .upload(filePath, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) throw new Error(`Certificate upload failed: ${uploadError.message}`);

    const { error: updateError } = await this.supabase
      .from('certificates')
      .update({ file_path: filePath })
      .eq('id', certificateId)
      .eq('user_id', userId);
    if (updateError) throw new Error(`Certificate file update failed: ${updateError.message}`);
    return filePath;
  }

  async getCertificateFileUrl(filePath: string): Promise<string | null> {
    const { data, error } = await this.supabase.storage.from('certificates').createSignedUrl(filePath, 3600);
    if (error) return null;
    return data.signedUrl;
  }

  async uploadRoiPayoutFile(file: File, firmName: string): Promise<string> {
    const userId = await this.getAuthenticatedUserId();
    const firmFolder = firmName.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'independent-firm';
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const filePath = `${userId}/${firmFolder}/payouts/${Date.now()}-${safeFileName}`;
    const { error } = await this.supabase.storage
      .from('certificates')
      .upload(filePath, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw new Error(`Payout receipt upload failed: ${error.message}`);
    return filePath;
  }

  async getPayouts(userId: string): Promise<Payout[]> {
    const { data, error } = await this.supabase
      .from('payouts')
      .select('*')
      .eq('user_id', userId)
      .order('payout_date', { ascending: false });
    if (error) throw new Error(`Payout loading failed: ${error.message}`);
    return (data as Payout[]) || [];
  }

  async getRoiTransactions(userId: string): Promise<RoiTransaction[]> {
    const { data, error } = await this.supabase
      .from('roi_transactions')
      .select('*, accounts(name)')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false });
    if (error) throw new Error(`ROI transaction loading failed: ${error.message}`);
    return (data as RoiTransaction[]) || [];
  }

  async createRoiTransaction(transaction: Omit<RoiTransaction, 'id' | 'created_at' | 'updated_at' | 'accounts' | 'user_id'>, userId: string): Promise<RoiTransaction> {
    const { data, error } = await this.supabase
      .from('roi_transactions')
      .insert({ ...transaction, user_id: userId })
      .select('*, accounts(name)')
      .single();
    if (error) throw new Error(`ROI transaction creation failed: ${error.message}`);
    return data as RoiTransaction;
  }

  async updateRoiTransaction(id: string, updates: Omit<Partial<RoiTransaction>, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'accounts'>): Promise<RoiTransaction> {
    const userId = await this.getAuthenticatedUserId();
    const { data, error } = await this.supabase
      .from('roi_transactions')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*, accounts(name)')
      .single();
    if (error) throw new Error(`ROI transaction update failed: ${error.message}`);
    return data as RoiTransaction;
  }

  async deleteRoiTransaction(id: string): Promise<void> {
    const userId = await this.getAuthenticatedUserId();
    const { error } = await this.supabase
      .from('roi_transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new Error(`ROI transaction deletion failed: ${error.message}`);
  }

  async getAllTrades(accountId?: string): Promise<Trade[]> {
    let query = this.supabase
      .from('trades')
      .select('*');
    if (accountId) {
      query = query.eq('account_id', accountId);
    }
    const { data, error } = await query.order('time_open', { ascending: false });
    if (error) { console.error('Error fetching trades:', error); return []; }
    return (data as Trade[]) || [];
  }

  async getAccountIdByName(accountName: string): Promise<string | null> {
    const exactLookup = await this.supabase
      .from('accounts')
      .select('id')
      .eq('name', accountName)
      .maybeSingle();
    if (exactLookup.error) throw new Error(`Account lookup failed: ${exactLookup.error.message}`);
    if (exactLookup.data?.id) return exactLookup.data.id;

    const accountNumber = accountName.match(/#(\d+)/)?.[1];
    if (!accountNumber) return null;

    const numberLookup = await this.supabase
      .from('accounts')
      .select('id')
      .eq('account_number', accountNumber)
      .maybeSingle();
    if (numberLookup.error) throw new Error(`Account-number lookup failed: ${numberLookup.error.message}`);
    return numberLookup.data?.id ?? null;
  }

  async getOrCreateAccountId(accountName: string): Promise<string> {
    const userId = await this.getAuthenticatedUserId();
    const existingId = await this.getAccountIdByName(accountName);
    if (existingId) return existingId;

    const accountNumber = accountName.match(/#(\d+)/)?.[1] ?? null;
    const { data, error } = await this.supabase
      .from('accounts')
      .insert({ name: accountName, account_number: accountNumber, user_id: userId })
      .select('id')
      .single();
    if (error) throw new Error(`Account creation failed: ${error.message}`);
    return data.id;
  }

  async getTradesByDateRange(startDate: string, endDate: string, accountId?: string): Promise<Trade[]> {
    let query = this.supabase
      .from('trades')
      .select('*')
      .gte('time_open', startDate)
      .lte('time_open', endDate);
    if (accountId) {
      query = query.eq('account_id', accountId);
    }
    const { data, error } = await query.order('time_open', { ascending: true });
    if (error) { console.error('Error fetching trades by date range:', error); return []; }
    return (data as Trade[]) || [];
  }

  async getTradeByTicket(ticket: number | string, accountId?: string): Promise<Trade | null> {
    let query = this.supabase
      .from('trades')
      .select('*')
      .eq('ticket', ticket);
    if (accountId) query = query.eq('account_id', accountId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Trade lookup failed: ${error.message}`);
    return data as Trade | null;
  }

  async getTradesWithNullTickets(accountId: string): Promise<Trade[]> {
    const { data, error } = await this.supabase
      .from('trades')
      .select('id, account_id, ticket, time_open')
      .eq('account_id', accountId)
      .is('ticket', null)
      .order('time_open', { ascending: true, nullsFirst: false });
    if (error) throw new Error(`Null-ticket trade lookup failed: ${error.message}`);
    return (data as Trade[]) || [];
  }

  async updateTradeTicket(id: string, ticket: number | string): Promise<Trade | null> {
    return this.updateTrade(id, { ticket });
  }

  async updateTradeMfeMaeByTicket(ticket: number | string, accountId: string, mfe: number, mae: number): Promise<Trade | null> {
    const { data, error } = await this.supabase
      .from('trades')
      .update({ mfe, mae })
      .eq('ticket', ticket)
      .eq('account_id', accountId)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Trade MFE/MAE update failed: ${error.message}`);
    return data as Trade | null;
  }

  /**
   * Fetch all trades from Supabase, ordered by time_open descending,
   * and map them to the NotionPerformanceData shape that the dashboard
   * expects (so the table/charts work without touching the template).
   *
   * This replaces the old loadNotionPerformanceData() flow that paginated
   * the Notion API via the NotionProxyApi backend.
   */
  async getTradeHistory(): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('trades')
      .select('*, accounts(name)')
      .order('time_open', { ascending: false, nullsFirst: false });
    if (error) {
      console.error('Error fetching trade history from Supabase:', error);
      return [];
    }
    return (data || []).map(row => this.mapTradeToNotionPerf(row));
  }

  /**
   * Map a Supabase trades row to the NotionPerformanceData interface.
   * Fields not present in Supabase (e.g. strategy, modelCheck, screenshots)
   * are defaulted so the dashboard table doesn't break.
   */
  private mapTradeToNotionPerf(row: any): any {
    const accountName = row.accounts?.name || '';
    const accountArr = accountName ? [accountName] : [];

    // rules_violated is stored as text — wrap to array for multi_select display
    const rulesViolatedArr = row.rules_violated ? [row.rules_violated] : [];

    // rrr is text like "+13.80R" — keep as-is
    // held is text like "6h 15m" — keep as-is
    // mup is numeric — keep as number

    return {
      id: row.id || '',
      action: '',                    // Notion title — not in Supabase
      date: row.time_open || '',    // start date
      idealRRR: '',                  // not in Supabase
      buySell: row.buy_sell || '',
      modelCheck: [],                // not in Supabase
      status: '',                    // not in Supabase
      percentPnL: 0,                 // computed elsewhere
      weeklyRetrospective: row.weekly_retrospective || '',
      account: accountArr,
      strategy: '',                  // not in Supabase
      oneToOneReversal: false,       // not in Supabase
      screenshots: [],               // not in Supabase
      modelForm: [],                 // not in Supabase
      idealSL: '',                   // not in Supabase
      reviewed: false,               // not in Supabase
      uniqueID: 0,                   // not in Supabase
      commission: row.commission ?? 0,
      outcome: [],                   // not in Supabase
      held: row.held || '',
      instrument: row.instrument || '',
      pnl: row.pnl ?? 0,
      percentPnLCalc: '',            // formula — not stored
      dailyReflection: row.daily_reflection || '',
      lots: row.lots ?? 0,
      divergenceValue: 0,            // not in Supabase
      pips: row.pips ?? 0,
      formula: row.pnl ?? 0,         // formula placeholder = pnl
      rulesViolated: rulesViolatedArr,
      emptySelect: '',               // not in Supabase
      swap: row.swap ?? 0,
      // Extra Supabase-specific fields (useful for the dashboard):
      ticket: row.ticket,
      time_close: row.time_close,
      mup: row.mup,
      price_close: row.price_close,
      price_open: row.price_open,
      risk_per_trade: row.risk_per_trade,
      rrr: row.rrr,
      sl: row.sl,
      tp: row.tp
    };
  }

  async getTradeByDate(dateStart: string): Promise<Trade | null> {
    const { data, error } = await this.supabase
      .from('trades')
      .select('*')
      .eq('time_open', dateStart)
      .maybeSingle();
    if (error) { console.error('Error fetching trade by date:', error); return null; }
    return data as Trade | null;
  }

  async createTrade(trade: Partial<Trade>): Promise<Trade | null> {
    const { data, error } = await this.supabase
      .from('trades')
      .insert(trade)
      .select()
      .single();
    if (error) throw new Error(`Trade insert failed: ${error.message}`);
    return data as Trade;
  }

  async saveTradeForAccount(trade: Partial<Trade>, accountId: string): Promise<Trade | null> {
    const tradeForAccount = { ...trade, account_id: accountId };
    if (tradeForAccount.ticket !== undefined && tradeForAccount.ticket !== null) {
      const existing = await this.getTradeByTicket(tradeForAccount.ticket);
      if (existing?.id) return this.updateTrade(existing.id, tradeForAccount);
    }
    return this.createTrade(tradeForAccount);
  }

  async syncMt5Trades(trades: Partial<Trade>[], accountName: string): Promise<{ created: number; updated: number }> {
    const accountId = await this.getOrCreateAccountId(accountName);
    return this.syncTradesToAccount(trades, accountId);
  }

  async syncTradesToAccount(
    trades: Partial<Trade>[],
    accountId: string,
    onProgress?: (processed: number, total: number, created: number, updated: number) => void
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const [index, trade] of trades.entries()) {
      const accountTrade = { ...trade, account_id: accountId };
      if (accountTrade.ticket === undefined || accountTrade.ticket === null) {
        onProgress?.(index + 1, trades.length, created, updated);
        continue;
      }

      const existing = await this.getTradeByTicket(accountTrade.ticket);
      if (existing?.id) {
        const updates = { ...accountTrade };
        const hasRiskPlaceholder = updates.risk_per_trade === undefined || updates.risk_per_trade === null || updates.risk_per_trade === 0;
        const hasRrrPlaceholder = updates.rrr === undefined || updates.rrr === null || updates.rrr === '' || updates.rrr === '0';
        const hasReflectionPlaceholder = updates.daily_reflection === undefined || updates.daily_reflection === null || updates.daily_reflection === '';
        const hasRulesPlaceholder = updates.rules_violated === undefined || updates.rules_violated === null || updates.rules_violated === '';
        const hasRetrospectivePlaceholder = updates.weekly_retrospective === undefined || updates.weekly_retrospective === null || updates.weekly_retrospective === '';
        const hasMupPlaceholder = updates.mup === undefined || updates.mup === null;

        if (existing.risk_per_trade !== null && existing.risk_per_trade !== undefined && hasRiskPlaceholder) {
          delete updates.risk_per_trade;
        }
        if (existing.rrr !== null && existing.rrr !== undefined && hasRrrPlaceholder) {
          delete updates.rrr;
        }
        if (existing.daily_reflection !== null && existing.daily_reflection !== undefined && hasReflectionPlaceholder) {
          delete updates.daily_reflection;
        }
        if (existing.rules_violated !== null && existing.rules_violated !== undefined && hasRulesPlaceholder) {
          delete updates.rules_violated;
        }
        if (existing.weekly_retrospective !== null && existing.weekly_retrospective !== undefined && hasRetrospectivePlaceholder) {
          delete updates.weekly_retrospective;
        }
        if (existing.mup !== null && existing.mup !== undefined && hasMupPlaceholder) {
          delete updates.mup;
        }

        const saved = await this.updateTrade(existing.id, updates);
        if (saved) updated++;
      } else {
        const saved = await this.createTrade({
          ...accountTrade,
          time_open: this.addThirteenHours(accountTrade.time_open),
          time_close: this.addThirteenHours(accountTrade.time_close)
        });
        if (saved) created++;
      }
      onProgress?.(index + 1, trades.length, created, updated);
    }

    return { created, updated };
  }

  private addThirteenHours(timestamp?: string): string | undefined {
    if (!timestamp) return undefined;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return new Date(date.getTime() + 13 * 60 * 60 * 1000).toISOString();
  }

  async updateTrade(id: string, updates: Partial<Trade>): Promise<Trade | null> {
    const { data, error } = await this.supabase
      .from('trades')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Trade update failed: ${error.message}`);
    return data as Trade;
  }

  async getTradeScreenshotUrl(ticket: number | string): Promise<string | null> {
    const urls = await this.getTradeScreenshotUrls([ticket]);
    return urls[String(ticket)]?.[0] ?? null;
  }

  async getTradeScreenshotUrls(tickets: Array<number | string>): Promise<Record<string, string[]>> {
    if (!tickets.length) return {};

    const { data, error } = await this.supabase
      .from('trade_screenshots')
      .select('ticket, storage_path')
      .in('ticket', tickets.map(ticket => String(ticket)));
    if (error) throw new Error(`Trade screenshot loading failed: ${error.message}`);

    const urls: Record<string, string[]> = {};
    for (const screenshot of data ?? []) {
      if (screenshot.ticket === null || !screenshot.storage_path) continue;
      const { data: signedFile, error: signedError } = await this.supabase.storage
        .from('trade-screenshots')
        .createSignedUrl(screenshot.storage_path, 86400);
      if (signedError || !signedFile?.signedUrl) {
        console.warn('Trade screenshot signed URL failed:', { ticket: screenshot.ticket, storagePath: screenshot.storage_path, error: signedError });
        continue;
      }
      (urls[String(screenshot.ticket)] ??= []).push(signedFile.signedUrl);
    }
    return urls;
  }

  async uploadTradeScreenshot(ticket: number | string, file: File, symbol?: string): Promise<string> {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const storagePath = `${String(ticket)}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await this.supabase.storage
      .from('trade-screenshots')
      .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) throw new Error(`Screenshot upload failed: ${uploadError.message}`);

    const { error: metadataError } = await this.supabase
      .from('trade_screenshots')
      .insert({ ticket: String(ticket), symbol: symbol || null, storage_path: storagePath });
    if (metadataError) throw new Error(`Screenshot metadata save failed: ${metadataError.message}`);

    const { data, error: signedUrlError } = await this.supabase.storage
      .from('trade-screenshots')
      .createSignedUrl(storagePath, 86400);
    if (signedUrlError || !data?.signedUrl) throw new Error(`Screenshot URL creation failed: ${signedUrlError?.message || 'unknown error'}`);
    return data.signedUrl;
  }

  async deleteTradeScreenshot(ticket: number | string, signedUrl: string): Promise<void> {
    const { data: screenshots, error: lookupError } = await this.supabase
      .from('trade_screenshots')
      .select('storage_path')
      .eq('ticket', String(ticket));
    if (lookupError) throw new Error(`Screenshot lookup failed: ${lookupError.message}`);

    const signedPath = decodeURIComponent(new URL(signedUrl).pathname);
    const pathPrefix = '/storage/v1/object/sign/trade-screenshots/';
    const storagePath = signedPath.startsWith(pathPrefix) ? signedPath.slice(pathPrefix.length) : '';
    const screenshot = (screenshots ?? []).find(row => row.storage_path === storagePath);
    if (!screenshot?.storage_path) throw new Error('Screenshot could not be identified.');

    const { error: storageError } = await this.supabase.storage
      .from('trade-screenshots')
      .remove([screenshot.storage_path]);
    if (storageError) throw new Error(`Screenshot deletion failed: ${storageError.message}`);

    const { data: deletedRows, error: metadataError } = await this.supabase
      .from('trade_screenshots')
      .delete()
      .eq('ticket', String(ticket))
      .eq('storage_path', screenshot.storage_path)
      .select('id');
    if (metadataError) throw new Error(`Screenshot metadata deletion failed: ${metadataError.message}`);
    if (!deletedRows?.length) {
      throw new Error('Screenshot was not deleted. Apply the screenshot DELETE policies in Supabase.');
    }
  }

  async uploadFile(file: File, path: string): Promise<string | null> {
    const { error } = await this.supabase.storage
      .from('trade-files')
      .upload(path, file);
    if (error) { console.error('Error uploading file:', error); return null; }
    const { data: urlData } = this.supabase.storage
      .from('trade-files')
      .getPublicUrl(path);
    return urlData.publicUrl;
  }

  subscribeToTrades(callback: (payload: any) => void) {
    return this.supabase
      .channel('trades-channel')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'trades'
      }, callback)
      .subscribe();
  }
}
