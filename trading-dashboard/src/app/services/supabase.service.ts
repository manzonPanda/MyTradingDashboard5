import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { Mt5TimeService, normalizeMt5ServerTime } from './mt5-time.service';

export interface PropFirm {
  id: string;
  name: string;
  logo_url?: string | null;
  website_url?: string | null;
  created_at?: string;
}

export type AccountPlatform = 'MT5' | 'Tradovate' | 'Wealthcharts';

export interface Account {
  id: string;
  name: string;
  platform?: AccountPlatform | null;
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
  account_id?: string | null;
  user_id?: string;
  firm_name: string;
  amount: number;
  payout_date: string;
  notes?: string | null;
  proof_url?: string | null;
  source?: 'certificate' | 'roi';
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
  time_open_ph?: string;
  time_close?: string;
  time_close_ph?: string;
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

  constructor(private readonly mt5Time: Mt5TimeService) {
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
      .select('id, name, platform, prop_firm_id, account_number, initial_balance, profit_target_percent, max_total_drawdown_percent, daily_loss_limit_percent, start_date, status, phase, created_at')
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
        .select('id, name, platform, prop_firm_id, account_number, initial_balance, profit_target_percent, max_total_drawdown_percent, daily_loss_limit_percent, start_date, status, phase, created_at, updated_at')
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
      .select('id, name, platform, prop_firm_id, account_number, initial_balance, profit_target_percent, max_total_drawdown_percent, daily_loss_limit_percent, start_date, status, phase, created_at, updated_at')
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

  async uploadRoiExpenseFile(file: File, firmName: string): Promise<string> {
    const userId = await this.getAuthenticatedUserId();
    const firmFolder = firmName.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'independent-firm';
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const filePath = `${userId}/${firmFolder}/expenses/${Date.now()}-${safeFileName}`;
    const { error } = await this.supabase.storage
      .from('certificates')
      .upload(filePath, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw new Error(`Expense image upload failed: ${error.message}`);
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

  private getCertificateStoragePath(fileReference: string | null | undefined): string | null {
    if (!fileReference) return null;
    if (!/^https?:\/\//i.test(fileReference)) return fileReference;

    try {
      const fileUrl = new URL(fileReference);
      const supabaseUrl = new URL(environment.supabase.url);
      if (fileUrl.origin !== supabaseUrl.origin) return null;

      const objectPrefix = '/storage/v1/object/';
      if (!fileUrl.pathname.startsWith(objectPrefix)) return null;
      const [accessType, bucket, ...pathSegments] = fileUrl.pathname.slice(objectPrefix.length).split('/');
      if (!['public', 'sign', 'authenticated'].includes(accessType) || bucket !== 'certificates' || !pathSegments.length) return null;

      return pathSegments.map(segment => decodeURIComponent(segment)).join('/');
    } catch {
      return null;
    }
  }

  async deleteRoiTransaction(id: string): Promise<void> {
    const userId = await this.getAuthenticatedUserId();
    const { data: transaction, error: lookupError } = await this.supabase
      .from('roi_transactions')
      .select('image_url')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (lookupError) throw new Error(`ROI transaction lookup failed: ${lookupError.message}`);

    const storagePath = this.getCertificateStoragePath(transaction?.image_url);
    if (storagePath) {
      const { error: storageError } = await this.supabase.storage
        .from('certificates')
        .remove([storagePath]);
      if (storageError) throw new Error(`Payout receipt deletion failed: ${storageError.message}`);
    }

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
      .insert({ name: accountName, account_number: accountNumber, platform: 'MT5', user_id: userId })
      .select('id')
      .single();
    if (error) throw new Error(`Account creation failed: ${error.message}`);
    return data.id;
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

  async updateTradeByTicket(ticket: number | string, accountId: string, updates: Partial<Trade>): Promise<Trade | null> {
    const { data, error } = await this.supabase
      .from('trades')
      .update(this.withPhilippineCloseTimestamp(updates))
      .eq('ticket', ticket)
      .eq('account_id', accountId)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Trade status update failed: ${error.message}`);
    return data as Trade | null;
  }

  async createTrade(trade: Partial<Trade>): Promise<Trade | null> {
    const normalizedOpen = normalizeMt5ServerTime(trade.time_open);
    const normalizedClose = normalizeMt5ServerTime(trade.time_close);
    const tradeToInsert = {
      ...trade,
      // The original MT5 server timestamp is stored unchanged in time_open.
      // time_open_ph is derived from it via the DST-aware EET/EEST → Asia/Manila
      // conversion (never "now"), so the pairing is always correct.
      ...(normalizedOpen ? { time_open: normalizedOpen } : {}),
      ...(normalizedClose ? { time_close: normalizedClose } : {}),
      ...(trade.time_open_ph == null && normalizedOpen
        ? { time_open_ph: this.mt5Time.mt5ServerTimeToPhilippine(normalizedOpen) }
        : {}),
      ...(normalizedClose && trade.time_close_ph == null
        ? { time_close_ph: this.mt5Time.mt5ServerTimeToPhilippine(normalizedClose) }
        : {})
    };
    const { data, error } = await this.supabase
      .from('trades')
      .insert(tradeToInsert)
      .select()
      .single();
    if (error) throw new Error(`Trade insert failed: ${error.message}`);
    return data as Trade;
  }

  async deleteTradeByTicket(ticket: number | string, accountId: string): Promise<void> {
    const { error } = await this.supabase
      .from('trades')
      .delete()
      .eq('ticket', ticket)
      .eq('account_id', accountId);
    if (error) throw new Error(`Trade deletion failed: ${error.message}`);
  }

  async saveTradeForAccount(trade: Partial<Trade>, accountId: string): Promise<Trade | null> {
    const tradeForAccount = { ...trade, account_id: accountId };
    if (tradeForAccount.ticket !== undefined && tradeForAccount.ticket !== null) {
      const existing = await this.getTradeByTicket(tradeForAccount.ticket);
      if (existing?.id) return this.updateTrade(existing.id, tradeForAccount);
    }

    try {
      return await this.createTrade(tradeForAccount);
    } catch (error) {
      if (!this.isDuplicateTradeError(error) || tradeForAccount.ticket === undefined || tradeForAccount.ticket === null) {
        throw error;
      }

      const conflictingTrade = await this.getTradeByTicket(tradeForAccount.ticket);
      if (!conflictingTrade?.id) throw error;
      return this.updateTrade(conflictingTrade.id, tradeForAccount);
    }
  }

  async syncTradesToAccount(
    trades: Partial<Trade>[],
    accountId: string,
    onProgress?: (processed: number, total: number, created: number, updated: number) => void | Promise<void>,
    shouldContinue?: () => boolean,
    existingByTicket?: Map<string, Trade>
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const [index, trade] of trades.entries()) {
      if (shouldContinue && !shouldContinue()) {
        throw new Error('Automatic MT5 sync stopped because the connected account changed.');
      }

      const accountTrade = { ...trade, account_id: accountId };
      if (accountTrade.ticket === undefined || accountTrade.ticket === null) {
        await onProgress?.(index + 1, trades.length, created, updated);
        continue;
      }

      const existing = existingByTicket?.get(String(accountTrade.ticket))
        ?? await this.getTradeByTicket(accountTrade.ticket, accountId);
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

        // Idempotency: skip the write entirely when nothing actually changed.
        if (this.tradeUpdatesChanged(existing, updates)) {
          const saved = await this.updateTrade(existing.id, updates);
          if (saved) updated++;
        }
      } else {
        try {
          // time_open / time_close keep the ORIGINAL MT5 server timestamps;
          // time_open_ph / time_close_ph are derived from them.
          const saved = await this.createTrade(accountTrade);
          if (saved) created++;
        } catch (error) {
          if (!this.isDuplicateTradeError(error)) throw error;

          const conflictingTrade = existingByTicket?.get(String(accountTrade.ticket))
            ?? await this.getTradeByTicket(accountTrade.ticket, accountId);
          if (!conflictingTrade?.id) throw error;

          const saved = await this.updateTrade(conflictingTrade.id, accountTrade);
          if (saved) updated++;
        }
      }
      await onProgress?.(index + 1, trades.length, created, updated);
    }

    return { created, updated };
  }

  /**
   * True when any field in `updates` (already placeholder-stripped) differs from
   * the existing DB row. Timestamps are compared after normalizing separators so
   * "2026-07-31T19:42:21" and "2026-07-31 19:42:21" are treated as equal.
   */
  private tradeUpdatesChanged(existing: Trade, updates: Partial<Trade>): boolean {
    return Object.entries(updates).some(([key, value]) => {
      if (value === undefined || value === null) return false;
      const current = (existing as Record<string, unknown>)[key];
      if (current === undefined || current === null) return true;

      if (typeof value === 'string' && typeof current === 'string') {
        return this.normalizeComparable(value) !== this.normalizeComparable(current);
      }
      if (typeof value === 'number' && typeof current === 'number') {
        return value !== current;
      }
      return String(value) !== String(current);
    });
  }

  private normalizeComparable(value: string): string {
    return value
      .replace('T', ' ')
      .replace(/\.\d+(Z)?$/, '')
      .replace(/Z$/, '')
      .trim();
  }

  private isDuplicateTradeError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('duplicate key value violates unique constraint');
  }

  private withPhilippineCloseTimestamp(updates: Partial<Trade>): Partial<Trade> {
    if (updates.time_close === undefined || updates.time_close_ph != null) return updates;
    const normalizedClose = normalizeMt5ServerTime(updates.time_close);
    if (!normalizedClose) return updates;
    // Derive time_close_ph from the original MT5 server close time (DST-aware),
    // never from the current local clock.
    return {
      ...updates,
      time_close: normalizedClose,
      time_close_ph: this.mt5Time.mt5ServerTimeToPhilippine(normalizedClose),
    };
  }

  async updateTrade(id: string, updates: Partial<Trade>): Promise<Trade | null> {
    const { data, error } = await this.supabase
      .from('trades')
      .update(this.withPhilippineCloseTimestamp(updates))
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Trade update failed: ${error.message}`);
    return data as Trade;
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
}
