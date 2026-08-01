import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export interface Account {
  id: string;
  name: string;
  account_number?: string | null;
  created_at?: string;
}

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

  async getAccounts(): Promise<Account[]> {
    const { data, error } = await this.supabase
      .from('accounts')
      .select('id, name, account_number, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Account loading failed: ${error.message}`);
    return (data as Account[]) || [];
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
    const existingId = await this.getAccountIdByName(accountName);
    if (existingId) return existingId;

    const accountNumber = accountName.match(/#(\d+)/)?.[1] ?? null;
    const { data, error } = await this.supabase
      .from('accounts')
      .insert({ name: accountName, account_number: accountNumber })
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

  async getTradeByTicket(ticket: number | string): Promise<Trade | null> {
    const { data, error } = await this.supabase
      .from('trades')
      .select('*')
      .eq('ticket', ticket)
      .maybeSingle();
    if (error) throw new Error(`Trade lookup failed: ${error.message}`);
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

  async syncMt5Trades(trades: Partial<Trade>[], accountName: string): Promise<{ created: number; updated: number }> {
    const accountId = await this.getOrCreateAccountId(accountName);

    let created = 0;
    let updated = 0;

    for (const trade of trades) {
      trade.account_id = accountId;
      if (trade.ticket === undefined || trade.ticket === null) continue;

      const existing = await this.getTradeByTicket(trade.ticket);
      if (existing?.id) {
        const saved = await this.updateTrade(existing.id, trade);
        if (saved) updated++;
      } else {
        const saved = await this.createTrade(trade);
        if (saved) created++;
      }
    }

    return { created, updated };
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
