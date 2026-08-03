import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TradeService } from '../services/trade.service';

export interface LiveTradeSoundSettings {
  enabled: boolean;
  alertThreshold: number;
  highAlertThreshold: number;
  volume: number;
}

interface Table {
  openDate: string;
  status: string;
  position: string;
  symbol: string;
  type: string;
  volume: string;
  entry: string;
  sL: string;
  tP: string;
  closeDate: string;
  exit: string;
  profit: string;
  netProfit: string;
  riskPerTrade: string;
  rrr: string;
  mt5status: string;
  mfe: string;
  mae?: string;
}

@Component({
  selector: 'app-live-rr-tracker',
  standalone: true,
  imports: [CommonModule, MatIconModule, FormsModule],
  template: `
    <div class="live-rr-tracker-container">
      <!-- Empty State - No Live Trades -->
      <div *ngIf="!hasLiveTrades" class="empty-state-container">
        <div class="empty-state-content">
          <!-- Decorative Animation Background -->
          <div class="animated-bg">
            <div class="floating-orb orb-1"></div>
            <div class="floating-orb orb-2"></div>
            <div class="floating-orb orb-3"></div>
          </div>

          <!-- Two Column Layout -->
          <div class="two-column-layout">
            <!-- Left Column: Icon and Title -->
            <div class="column left-column">
              <!-- Main Icon -->
              <div class="empty-state-icon">
                <div class="icon-wrapper">
                  <mat-icon class="main-icon">trending_up</mat-icon>
                  <div class="icon-pulse-ring"></div>
                </div>
              </div>

              <!-- Title -->
              <div class="empty-state-text">
                <h2 class="empty-title">Ready to Trade?</h2>
              </div>
            </div>

            <!-- Right Column: Description and Features -->
            <div class="column right-column">
              <!-- Quick Stats Preview -->
              <div class="preview-stats">
                <div class="stat-badge">
                  <mat-icon>show_chart</mat-icon>
                  <span>Real-time RR</span>
                </div>
                <div class="stat-badge">
                  <mat-icon>trending_up</mat-icon>
                  <span>Live P&amp;L</span>
                </div>
                <div class="stat-badge">
                  <mat-icon>speed</mat-icon>
                  <span>Risk amount</span>
                </div>
                <div class="stat-badge">
                  <mat-icon>schedule</mat-icon>
                  <span>Holding time</span>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      <!-- Live Trading Display - When Trades Are Open -->
      <div *ngIf="hasLiveTrades" class="live-trading-container">
        <div class="live-header">
          <div class="header-title">
            <mat-icon class="live-icon">fiber_manual_record</mat-icon>
            <h3>Trades</h3>
          </div>
          <div class="header-meta">
            <button
              type="button"
              class="gauge-settings-button"
              aria-label="Open gauge settings"
              title="Gauge settings"
              (click)="openGaugeSettings()">
              <mat-icon>settings</mat-icon>
            </button>
            <button
              type="button"
              class="close-all-button"
              [disabled]="isClosingAll"
              (click)="closeAllTrades()">
              {{ isClosingAll ? 'Closing...' : (isCloseAllArmed ? 'Confirmed?' : 'Close All') }}
            </button>
            <span *ngIf="closeAllStatus" class="close-all-status" aria-live="polite">{{ closeAllStatus }}</span>
          </div>
        </div>

        <div *ngIf="isGaugeSettingsOpen" class="gauge-settings-backdrop" role="presentation" (click)="closeGaugeSettings()">
          <section class="gauge-settings-modal" role="dialog" aria-modal="true" aria-labelledby="gauge-settings-title" (click)="$event.stopPropagation()">
            <div class="gauge-settings-heading">
              <div class="gauge-settings-icon"><mat-icon>speed</mat-icon></div>
              <div>
                <span class="gauge-settings-eyebrow">Trades display</span>
                <h2 id="gauge-settings-title">Gauge settings</h2>
              </div>
              <button type="button" class="gauge-settings-close" aria-label="Close gauge settings" (click)="closeGaugeSettings()">
                <mat-icon>close</mat-icon>
              </button>
            </div>
            <p class="gauge-settings-description">Choose the positive P&amp;L percentage that fills the live trade gauge.</p>
            <label class="gauge-settings-field">
              <span>Maximum positive gauge</span>
              <div class="gauge-settings-input-wrap">
                <input type="number" min="0.1" max="100" step="0.1" [value]="gaugePercentDraft" (input)="gaugePercentDraft = $any($event.target).value" aria-describedby="gauge-settings-help">
                <strong>%</strong>
              </div>
            </label>
            <div id="gauge-settings-help" class="gauge-settings-help">
              <mat-icon>info</mat-icon>
              <span>Negative trades keep their existing counter-clockwise scale.</span>
            </div>
            <div class="gauge-settings-preview">
              <span>Current maximum</span>
              <strong>{{ positiveGaugePercentMax | number:'1.1-1' }}%</strong>
            </div>
            <div class="trade-display-sound-settings">
              <div class="trade-display-sound-heading">
                <mat-icon>volume_up</mat-icon>
                <strong>Sound notifications</strong>
              </div>
              <label class="trade-display-sound-toggle">
                <input type="checkbox" [checked]="soundSettingsDraft.enabled" (change)="soundSettingsDraft.enabled = $any($event.target).checked">
                <span>Enable sound alerts</span>
              </label>
              <label class="trade-display-sound-field">
                <span>Sound notification threshold</span>
                <input type="number" min="0" step="0.1" [(ngModel)]="soundSettingsDraft.alertThreshold" [disabled]="!soundSettingsDraft.enabled">
              </label>
              <label class="trade-display-sound-field">
                <span>High-priority sound threshold</span>
                <input type="number" min="0" step="0.1" [(ngModel)]="soundSettingsDraft.highAlertThreshold" [disabled]="!soundSettingsDraft.enabled">
              </label>
            </div>
            <div class="gauge-settings-actions">
              <button type="button" class="gauge-cancel-button" (click)="closeGaugeSettings()">Cancel</button>
              <button type="button" class="gauge-save-button" (click)="saveGaugeSettings(); saveSoundSettings()">Save settings</button>
            </div>
          </section>
        </div>

        <div class="live-metrics">
          <!-- Total RR Gained -->
          <div class="metric-card rr-card">
            <div class="metric-label">
              <mat-icon>trending_up</mat-icon>
              <span>Total R Gained</span>
            </div>
            <div class="metric-value" [ngClass]="getRRClass()">
              {{ totalRRGained }}
            </div>
          </div>

          <!-- Account Percentage -->
          <div class="metric-card percentage-card">
            <div class="metric-label">
              <mat-icon>account_balance</mat-icon>
              <span>Account Risk</span>
            </div>
            <div class="metric-value" [ngClass]="getPercentageClass()">
              {{ percentageOfAccount }}%
            </div>
          </div>

          <!-- Total Unrealized P&L -->
          <div class="metric-card pnl-card">
            <div class="metric-label">
              <mat-icon>money</mat-icon>
              <span>Unrealized P&L</span>
            </div>
            <div class="metric-value" [ngClass]="getPnLClass()">
              {{ totalUnrealizedPnL }}
            </div>
          </div>

        <div class="live-extremes-summary" aria-label="MFE and MAE">
          <span class="mfe-value" title="MFE"><mat-icon>north_east</mat-icon><strong>MFE {{ formatR(totalMfeR) }}</strong><em>({{ formatCurrency(totalMfeValue) }})</em></span>
          <span class="extremes-divider">|</span>
          <span class="mae-value" title="MAE"><mat-icon>south_west</mat-icon><strong>MAE {{ formatR(totalMaeR) }}</strong><em>({{ formatCurrency(totalMaeValue) }})</em></span>
        </div>

        <div class="live-trade-gauges">
          <article *ngFor="let trade of openTrades" class="trade-gauge-card">
            <div class="trade-gauge-heading">
              <span class="trade-gauge-symbol" [attr.title]="trade.symbol">{{ formatHoldingTime(trade) }}</span>
            </div>
            <div class="trade-gauge-content">
              <div class="trade-gauge" [attr.aria-label]="trade.symbol + ' unrealized P&L gauge'">
                <svg viewBox="0 0 100 100" class="trade-gauge-svg">
                  <circle cx="50" cy="50" r="44" fill="none" stroke="#e5e7eb" stroke-width="10"/>
                  <circle cx="50" cy="50" r="44" fill="none" [attr.stroke]="getTradeGaugeColor(trade)" stroke-width="10" stroke-linecap="butt"
                          [attr.stroke-dasharray]="getTradeGaugeDash(trade)" [attr.transform]="getTradeGaugeTransform(trade)"/>
                  <rect x="48.5" y="0" width="3" height="16" class="trade-gauge-marker"/>
                </svg>
                <div class="trade-gauge-center">
                  <div class="trade-gauge-percent" [ngClass]="getTradePnLClass(trade)">{{ getTradePercent(trade) | number:'1.2-2' }}%</div>
                </div>
              </div>
            </div>
          </article>
        </div>
        </div>

      </div>
    </div>
  `,
  styleUrls: ['./live-rr-tracker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveRRTrackerComponent implements OnInit, OnChanges, OnDestroy {
  @Input() mt5LiveTrades: Table[] = [];
  @Input() tableData: Table[] = [];
  @Input() accountSize = 0;
  @Input() liveTradeSoundSettings: LiveTradeSoundSettings = { enabled: true, alertThreshold: 2.8, highAlertThreshold: 3.4, volume: 0.7 };
  @Output() liveTradeSoundSettingsChange = new EventEmitter<LiveTradeSoundSettings>();

  hasLiveTrades: boolean = false;
  openTradeCount: number = 0;
  openTrades: Table[] = [];
  totalRRGained: string = '+0.00R';
  totalRRValue: number = 0;
  percentageOfAccount: number = 0;
  totalUnrealizedPnL: string = '$0.00';
  totalUnrealizedValue: number = 0;
  totalMfeValue = 0;
  totalMaeValue = 0;
  totalMfeR = 0;
  totalMaeR = 0;
  isClosingAll = false;
  isCloseAllArmed = false;
  closeAllStatus = '';
  positiveGaugePercentMax = 4;
  gaugePercentDraft = '4';
  soundSettingsDraft: LiveTradeSoundSettings = { enabled: true, alertThreshold: 2.8, highAlertThreshold: 3.4, volume: 0.7 };
  isGaugeSettingsOpen = false;
  private holdingTimeInterval?: ReturnType<typeof setInterval>;
  private closeAllConfirmationTimeout?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly cdr: ChangeDetectorRef,
    private readonly tradeService: TradeService
  ) {}

  ngOnInit() {
    const savedGaugeMax = Number(localStorage.getItem('live-trade-gauge-max-percent'));
    if (Number.isFinite(savedGaugeMax) && savedGaugeMax >= 0.1 && savedGaugeMax <= 100) {
      this.positiveGaugePercentMax = savedGaugeMax;
      this.gaugePercentDraft = String(savedGaugeMax);
    }
    this.calculateLiveMetrics();
    this.holdingTimeInterval = setInterval(() => this.cdr.markForCheck(), 1000);
  }

  ngOnDestroy(): void {
    if (this.holdingTimeInterval) clearInterval(this.holdingTimeInterval);
    if (this.closeAllConfirmationTimeout) clearTimeout(this.closeAllConfirmationTimeout);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['mt5LiveTrades']) {
      this.calculateLiveMetrics();
    }

    // Also recalculate if tableData changes (in case trades are updated there)
    if (changes['tableData'] || changes['accountSize']) {
      this.calculateLiveMetrics();
    }
  }

  calculateLiveMetrics(): void {
    // Filter only open trades (either mt5status is OPEN or closeDate not set/is placeholder)
    const openTrades = this.mt5LiveTrades.filter(trade => {
      const isOpen = trade.mt5status === 'OPEN' || (trade.closeDate === '-' || !trade.closeDate);
      return isOpen;
    });

    this.hasLiveTrades = openTrades.length > 0;
    this.openTradeCount = openTrades.length;
    this.openTrades = openTrades;

    if (!this.hasLiveTrades) {
      this.resetMetrics();
      return;
    }

    // Calculate total RR and total stop loss risk
    let totalR = 0;
    let totalUnrealizedPnL = 0;
    let totalSlRisk = 0; // Total risk from stop loss
    let totalMfeValue = 0;
    let totalMaeValue = 0;

    openTrades.forEach((trade) => {
      const profit = parseFloat(trade.profit || '0') || 0;
      const slRisk = parseFloat(trade.riskPerTrade || '0') || 0;
      const tradeR = this.getTradeR(trade);
      totalR += tradeR;
      totalUnrealizedPnL += profit;
      totalSlRisk += slRisk;
      totalMfeValue += Math.max(0, Number(trade.mfe) || 0);
      totalMaeValue += Math.min(0, Number(trade.mae) || 0);
    });

    this.totalMfeValue = totalMfeValue;
    this.totalMaeValue = totalMaeValue;
    this.totalMfeR = totalSlRisk > 0 ? totalMfeValue / totalSlRisk : 0;
    this.totalMaeR = totalSlRisk > 0 ? totalMaeValue / totalSlRisk : 0;
    this.totalRRValue = totalR;
    this.totalRRGained = totalR >= 0 ? `+${totalR.toFixed(2)}R` : `${totalR.toFixed(2)}R`;

    const accountSize = this.accountSize > 0 ? this.accountSize : 0;
    this.percentageOfAccount = accountSize > 0
      ? parseFloat(((totalSlRisk / accountSize) * 100).toFixed(2))
      : 0;

    this.totalUnrealizedValue = totalUnrealizedPnL;
    this.totalUnrealizedPnL = this.formatCurrency(totalUnrealizedPnL);

  }

  resetMetrics(): void {
    this.totalRRGained = '+0.00R';
    this.totalRRValue = 0;
    this.percentageOfAccount = 0;
    this.totalUnrealizedPnL = '$0.00';
    this.totalUnrealizedValue = 0;
    this.totalMfeValue = 0;
    this.totalMaeValue = 0;
    this.totalMfeR = 0;
    this.totalMaeR = 0;
    this.openTrades = [];
  }

  openGaugeSettings(): void {
    this.gaugePercentDraft = String(this.positiveGaugePercentMax);
    this.soundSettingsDraft = { ...this.liveTradeSoundSettings };
    this.isGaugeSettingsOpen = true;
  }

  saveSoundSettings(): void {
    if (this.soundSettingsDraft.alertThreshold < 0 || this.soundSettingsDraft.highAlertThreshold <= this.soundSettingsDraft.alertThreshold || this.soundSettingsDraft.volume < 0 || this.soundSettingsDraft.volume > 1) return;
    this.liveTradeSoundSettingsChange.emit({ ...this.soundSettingsDraft });
  }

  closeGaugeSettings(): void {
    this.isGaugeSettingsOpen = false;
  }

  saveGaugeSettings(): void {
    const nextMax = Number(this.gaugePercentDraft);
    if (!Number.isFinite(nextMax) || nextMax < 0.1 || nextMax > 100) return;

    this.positiveGaugePercentMax = nextMax;
    this.gaugePercentDraft = String(nextMax);
    localStorage.setItem('live-trade-gauge-max-percent', String(nextMax));
    this.isGaugeSettingsOpen = false;
  }

  closeAllTrades(): void {
    if (this.isClosingAll || this.openTradeCount === 0) return;

    if (!this.isCloseAllArmed) {
      this.isCloseAllArmed = true;
      this.closeAllConfirmationTimeout = setTimeout(() => {
        this.isCloseAllArmed = false;
        this.cdr.markForCheck();
      }, 5000);
      this.cdr.markForCheck();
      return;
    }

    if (this.closeAllConfirmationTimeout) clearTimeout(this.closeAllConfirmationTimeout);
    this.isCloseAllArmed = false;
    this.closeAllStatus = '';
    this.isClosingAll = true;
    this.tradeService.closeAllTrades().subscribe({
      next: (response) => {
        if (response?.success) {
          this.openTrades = [];
          this.hasLiveTrades = false;
          this.openTradeCount = 0;
          this.resetMetrics();
          this.closeAllStatus = '';
        } else {
          this.closeAllStatus = 'Some trades could not be closed.';
        }
        this.isClosingAll = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        const failedTrade = error?.error?.failed?.[0];
        this.isClosingAll = false;
        this.closeAllStatus = failedTrade?.comment || failedTrade?.error || 'Unable to close the open trades.';
        this.cdr.markForCheck();
      }
    });
  }

  formatHoldingTime(trade: Table): string {
    const openedAt = new Date(trade.openDate || '').getTime();
    if (!Number.isFinite(openedAt)) return '00s';

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - openedAt) / 1000));
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    if (minutes > 0) {
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(seconds).padStart(2, '0')}s`;
  }

  getTradeProfit(trade: Table): number {
    return parseFloat(trade.profit || '0') || 0;
  }

  getTradePercent(trade: Table): number {
    return this.accountSize > 0
      ? (this.getTradeProfit(trade) / this.accountSize) * 100
      : 0;
  }

  getTradeGaugeDash(trade: Table): string {
    const circumference = 2 * Math.PI * 44;
    const value = this.getTradeProfit(trade) > 0
      ? Math.abs(this.getTradePercent(trade)) / this.positiveGaugePercentMax
      : Math.abs(this.getTradePercent(trade)) / 1;
    const fraction = Math.min(1, value);
    const arc = fraction * circumference;
    return `${arc} ${Math.max(0, circumference - arc)}`;
  }

  getTradeR(trade: Table): number {
    const reportedR = parseFloat(String(trade.rrr || '').replace('R', ''));
    if (Number.isFinite(reportedR)) return reportedR;

    const risk = parseFloat(trade.riskPerTrade || '0') || 0;
    return risk > 0 ? this.getTradeProfit(trade) / risk : 0;
  }

  getTradeGaugeColor(trade: Table): string {
    return this.getTradeProfit(trade) < 0 ? '#ef4444' : '#10b981';
  }

  getTradeGaugeTransform(trade: Table): string {
    return this.getTradeProfit(trade) < 0
      ? 'rotate(90 50 50) scale(-1 1) translate(-100 0)'
      : 'rotate(-90 50 50)';
  }

  getTradePnLClass(trade: Table): string {
    if (this.getTradeProfit(trade) > 0) return 'positive';
    if (this.getTradeProfit(trade) < 0) return 'negative';
    return 'neutral';
  }

  formatR(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
  }

  formatCurrency(amount: number): string {
    const absAmount = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    if (absAmount >= 1000) {
      return `${sign}$${(absAmount / 1000).toFixed(1)}K`;
    }
    return `${sign}$${absAmount.toFixed(2)}`;
  }

  getRRClass(): string {
    if (this.totalRRValue > 0) return 'positive';
    if (this.totalRRValue < 0) return 'negative';
    return 'neutral';
  }

  getPercentageClass(): string {
    if (this.percentageOfAccount > 0) return 'positive';
    if (this.percentageOfAccount < 0) return 'negative';
    return 'neutral';
  }

  getPnLClass(): string {
    if (this.totalUnrealizedValue > 0) return 'positive';
    if (this.totalUnrealizedValue < 0) return 'negative';
    return 'neutral';
  }
}
