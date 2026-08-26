import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Account, Profile, SupabaseService, UserSettings } from '../services/supabase.service';
import { AuthService } from '../services/auth.service';

export interface LiveTradeDisplayPreferences {
  /** @deprecated Legacy localStorage copy; superseded by user_settings.positive_gauge_percent_max. */
  positiveGaugePercentMax?: number;
  soundEnabled: boolean;
  soundThreshold: number;
  highPrioritySoundThreshold: number;
}

const LIVE_TRADE_PREFERENCES_KEY = 'trading-dashboard.live-trade-display-preferences';

const defaults: Omit<UserSettings, 'user_id'> = {
  live_trade_sound_threshold: 2.8,
  live_trade_high_priority_sound_threshold: 3.4, daily_target_percent: 2,
  positive_gauge_percent_max: 4,
  per_trade_gauge_auto_close_enabled: true, weekly_r_target: 5,
  default_chart_mode: 'trades', trading_day_reset_time: '17:00', default_account_id: null,
  show_account_balance: true, show_pnl: true, show_trading_activity: true, show_news_calendar: true,
  aura_enabled: true, aura_travel_duration_ms: 2000, aura_min_delay_ms: 2000, aura_max_delay_ms: 5000,
  aura_trail_length_percent: 8, aura_stroke_width: 6, aura_head_radius: 9, aura_bloom_intensity: 4.5,
  aura_fade_duration_ms: 180, aura_color_start: '#7C3AED', aura_color_mid: '#A78BFA', aura_color_peak: '#E9D5FF', aura_color_head: '#FFFFFF',
  aura_min_targets: 2, aura_max_targets: 4, notifications_enabled: true, daily_goal_notification: true,
  goal_notification_sound: true, notification_volume: .7
};

@Component({
  selector: 'app-profile-settings', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './profile-settings.component.html', styleUrls: ['./profile-settings.component.scss']
})
export class ProfileSettingsComponent implements OnInit {
  profile: Pick<Profile, 'display_name' | 'avatar_url' | 'started_trading_date'> = { display_name: '', avatar_url: '', started_trading_date: null };
  settings: Partial<UserSettings> = { ...defaults };
  accounts: Account[] = [];
  loading = true;
  saving = false;
  message = '';
  liveTradeDisplayPreferences: LiveTradeDisplayPreferences = {
    soundEnabled: true,
    soundThreshold: 2.8,
    highPrioritySoundThreshold: 3.4
  };
  @Output() closed = new EventEmitter<void>();
  @Output() dailyTargetChange = new EventEmitter<number>();
  @Output() positiveGaugePercentMaxChange = new EventEmitter<number>();
  @Output() perTradeGaugeAutoCloseChange = new EventEmitter<boolean>();
  @Output() liveTradeDisplayPreferencesChange = new EventEmitter<LiveTradeDisplayPreferences>();

  constructor(private readonly supabase: SupabaseService, readonly auth: AuthService, private readonly router: Router) {}

  async ngOnInit(): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) return;
    try {
      const [profile, settings, accounts] = await Promise.all([
        this.supabase.getProfile(userId), this.supabase.getUserSettings(userId), this.supabase.getAccounts()
      ]);
      if (profile) this.profile = { display_name: profile.display_name ?? '', avatar_url: profile.avatar_url ?? '', started_trading_date: profile.started_trading_date };
      const rawSettings = settings ?? {};
      this.settings = { ...defaults, ...rawSettings };
      // Rows created before the positive_gauge_percent_max column existed have
      // no stored value — fall back to the legacy localStorage copy so the
      // previously chosen maximum survives the migration.
      if (!('positive_gauge_percent_max' in rawSettings)) {
        try {
          const legacy = Number(JSON.parse(localStorage.getItem(LIVE_TRADE_PREFERENCES_KEY) || '{}')?.positiveGaugePercentMax);
          if (Number.isFinite(legacy) && legacy >= 0.1 && legacy <= 100) this.settings.positive_gauge_percent_max = legacy;
        } catch { /* ignore malformed legacy cache */ }
      }
      this.loadLiveTradeDisplayPreferences();
      this.accounts = accounts;
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Unable to load settings.';
    } finally { this.loading = false; }
  }

  async save(): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) return;
    this.saving = true; this.message = '';
    try {
      const gaugeMax = Number(this.settings.positive_gauge_percent_max);
      if (!Number.isFinite(gaugeMax) || gaugeMax < 0.1 || gaugeMax > 100) {
        throw new Error('Set the maximum positive gauge between 0.1 and 100.');
      }
      this.validateLiveTradeDisplayPreferences();
      this.settings = {
        ...this.settings,
        live_trade_sound_threshold: this.liveTradeDisplayPreferences.soundThreshold,
        live_trade_high_priority_sound_threshold: this.liveTradeDisplayPreferences.highPrioritySoundThreshold
      };
      await Promise.all([
        this.supabase.updateProfile(userId, this.profile),
        this.supabase.updateUserSettings(userId, this.settings)
      ]);
      this.saveLiveTradeDisplayPreferences();
      const dailyTarget = Number(this.settings.daily_target_percent);
      if (Number.isFinite(dailyTarget)) this.dailyTargetChange.emit(dailyTarget);
      this.positiveGaugePercentMaxChange.emit(gaugeMax);
      this.perTradeGaugeAutoCloseChange.emit(this.settings.per_trade_gauge_auto_close_enabled !== false);
      this.message = 'Settings saved.';
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Unable to save settings.';
    } finally { this.saving = false; }
  }

  private loadLiveTradeDisplayPreferences(): void {
    const soundThreshold = Number(this.settings.live_trade_sound_threshold);
    const highPrioritySoundThreshold = Number(this.settings.live_trade_high_priority_sound_threshold);
    if (Number.isFinite(soundThreshold) && soundThreshold >= 0) this.liveTradeDisplayPreferences.soundThreshold = soundThreshold;
    if (Number.isFinite(highPrioritySoundThreshold) && highPrioritySoundThreshold > this.liveTradeDisplayPreferences.soundThreshold) this.liveTradeDisplayPreferences.highPrioritySoundThreshold = highPrioritySoundThreshold;

    const saved = localStorage.getItem(LIVE_TRADE_PREFERENCES_KEY);
    if (!saved) return;

    try {
      const preferences = JSON.parse(saved) as Partial<LiveTradeDisplayPreferences>;
      if (typeof preferences.soundEnabled === 'boolean') this.liveTradeDisplayPreferences.soundEnabled = preferences.soundEnabled;
    } catch {
      localStorage.removeItem(LIVE_TRADE_PREFERENCES_KEY);
    }
  }

  private validateLiveTradeDisplayPreferences(): void {
    const preferences = this.liveTradeDisplayPreferences;
    if (preferences.soundThreshold < 0 || preferences.highPrioritySoundThreshold <= preferences.soundThreshold) {
      throw new Error('Set valid live trade sound thresholds.');
    }
  }

  private saveLiveTradeDisplayPreferences(): void {
    const preferences = this.liveTradeDisplayPreferences;
    localStorage.setItem(LIVE_TRADE_PREFERENCES_KEY, JSON.stringify({
      soundEnabled: preferences.soundEnabled
    }));
    this.liveTradeDisplayPreferencesChange.emit({ ...preferences });
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
