import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Account, Profile, SupabaseService, UserSettings } from '../services/supabase.service';
import { AuthService } from '../services/auth.service';

const defaults: Omit<UserSettings, 'user_id'> = {
  per_trade_target_percent: 1, sound_notifications_threshold: 2.8, daily_target_percent: 2, weekly_r_target: 5,
  default_chart_mode: 'trades', trading_day_reset_time: '17:00', default_account_id: null,
  show_account_balance: true, show_pnl: true, show_trading_activity: true, show_news_calendar: true,
  aura_enabled: true, aura_travel_duration_ms: 2000, aura_min_delay_ms: 2000, aura_max_delay_ms: 5000,
  aura_trail_length_percent: 8, aura_stroke_width: 6, aura_head_radius: 9, aura_bloom_intensity: 4.5,
  aura_fade_duration_ms: 180, aura_color_start: '#7C3AED', aura_color_mid: '#A78BFA', aura_color_peak: '#E9D5FF', aura_color_head: '#FFFFFF',
  aura_min_targets: 2, aura_max_targets: 4, notifications_enabled: true, daily_goal_notification: true,
  goal_notification_sound: true, notification_volume: .7
};

@Component({
  selector: 'app-profile-settings', standalone: true, imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './profile-settings.component.html', styleUrls: ['./profile-settings.component.scss', '../dashboard/dashboard.component.scss']
})
export class ProfileSettingsComponent implements OnInit {
  profile: Pick<Profile, 'display_name' | 'avatar_url' | 'started_trading_date'> = { display_name: '', avatar_url: '', started_trading_date: null };
  settings: Partial<UserSettings> = { ...defaults };
  accounts: Account[] = [];
  loading = true;
  saving = false;
  message = '';

  constructor(private readonly supabase: SupabaseService, readonly auth: AuthService, private readonly router: Router) {}

  async ngOnInit(): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) return;
    try {
      const [profile, settings, accounts] = await Promise.all([
        this.supabase.getProfile(userId), this.supabase.getUserSettings(userId), this.supabase.getAccounts()
      ]);
      if (profile) this.profile = { display_name: profile.display_name ?? '', avatar_url: profile.avatar_url ?? '', started_trading_date: profile.started_trading_date };
      this.settings = { ...defaults, ...(settings ?? {}) };
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
      await Promise.all([
        this.supabase.updateProfile(userId, this.profile),
        this.supabase.updateUserSettings(userId, this.settings)
      ]);
      this.message = 'Settings saved.';
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Unable to save settings.';
    } finally { this.saving = false; }
  }

  async navigateTo(path: string): Promise<void> {
    await this.router.navigateByUrl(path);
  }

  async backToDashboard(): Promise<void> {
    await this.router.navigateByUrl('/');
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
