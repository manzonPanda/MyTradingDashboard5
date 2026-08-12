import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, QueryList, SimpleChanges, ViewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import * as echarts from 'echarts';
import { Subscription } from 'rxjs';
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
  screenshotUrl?: string;
}

@Component({
  selector: 'app-live-rr-tracker',
  standalone: true,
  imports: [CommonModule, MatIconModule, FormsModule],
  template: `
    <div class="live-rr-tracker-container">
      <!-- Empty State - No Live Trades -->
      <div *ngIf="!hasLiveTrades" class="empty-state-container" [class.is-maximized]="isMaximized">
        <button
          type="button"
          class="live-trades-maximize-button"
          [attr.aria-label]="isMaximized ? 'Minimize live trades' : 'Maximize live trades'"
          [attr.title]="isMaximized ? 'Minimize live trades' : 'Maximize live trades'"
          (click)="toggleMaximize()">
          <mat-icon>{{ isMaximized ? 'fullscreen_exit' : 'fullscreen' }}</mat-icon>
        </button>
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
      <div *ngIf="hasLiveTrades" class="live-trading-container" [class.is-maximized]="isMaximized">
        <div class="live-header">
          <button
            type="button"
            class="live-trades-maximize-button"
            [attr.aria-label]="isMaximized ? 'Minimize live trades' : 'Maximize live trades'"
            [attr.title]="isMaximized ? 'Minimize live trades' : 'Maximize live trades'"
            (click)="toggleMaximize()">
            <mat-icon>{{ isMaximized ? 'fullscreen_exit' : 'fullscreen' }}</mat-icon>
          </button>
          <div class="header-title">
            <mat-icon class="live-icon">fiber_manual_record</mat-icon>
            <h3>Trades</h3>
          </div>
          <div class="header-meta">
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
                <span>Sound notification threshold (%)</span>
                <input type="number" min="0" step="0.1" aria-label="Sound notification threshold percentage" [(ngModel)]="soundSettingsDraft.alertThreshold" [disabled]="!soundSettingsDraft.enabled">
              </label>
              <label class="trade-display-sound-field">
                <span>High-priority sound threshold (%)</span>
                <input type="number" min="0" step="0.1" aria-label="High-priority sound threshold percentage" [(ngModel)]="soundSettingsDraft.highAlertThreshold" [disabled]="!soundSettingsDraft.enabled">
              </label>
            </div>
            <div class="gauge-settings-actions">
              <button type="button" class="gauge-cancel-button" (click)="closeGaugeSettings()">Cancel</button>
              <button type="button" class="gauge-save-button" (click)="saveGaugeSettings(); saveSoundSettings()">Save settings</button>
            </div>
          </section>
        </div>

        <div class="open-trade-metrics-list">
          <article *ngFor="let trade of openTrades; trackBy: trackByTrade" class="trade-metrics-grid">
            <div class="trade-metric-card trade-r-card">
              <div class="metric-label"><mat-icon>trending_up</mat-icon><span>Total R Gained</span></div>
              <div class="metric-value" [ngClass]="getTradeRClass(trade)">{{ formatR(getTradeR(trade)) }}</div>
            </div>

            <div class="trade-metric-card trade-risk-card">
              <div class="metric-label"><mat-icon>account_balance</mat-icon><span>Account Risk</span></div>
              <div class="metric-value" [ngClass]="getTradeRiskClass(trade)">{{ getTradeRiskPercent(trade) | number:'1.2-2' }}%</div>
            </div>

            <div class="trade-metric-card trade-pnl-card">
              <div class="metric-label"><mat-icon>money</mat-icon><span>Unrealized P&amp;L</span></div>
              <div class="metric-value" [ngClass]="getTradePnLClass(trade)">{{ formatCurrency(getTradeProfit(trade)) }}</div>
            </div>

            <div class="trade-extremes-summary" aria-label="MFE and MAE">
              <span class="mfe-value" title="MFE"><mat-icon>north_east</mat-icon><strong>MFE {{ formatR(getTradeMfeR(trade)) }}</strong><em>({{ formatCurrency(getTradeMfeValue(trade)) }})</em></span>
              <span class="extremes-divider">|</span>
              <span class="mae-value" title="MAE"><mat-icon>south_west</mat-icon><strong>MAE {{ formatR(getTradeMaeR(trade)) }}</strong><em>({{ formatCurrency(getTradeMaeValue(trade)) }})</em></span>
            </div>

            <div class="trade-gauge-card">
              <div class="trade-gauge-heading">
                <span class="trade-gauge-symbol" [attr.title]="formatHoldingTime(trade)">{{ formatHoldingTime(trade) }}</span>
              </div>
              <div class="trade-gauge-content">
                <div #tradeGauge class="trade-gauge" [attr.aria-label]="trade.symbol + ' unrealized P&L gauge'"></div>
              </div>
            </div>
          </article>
        </div>

      </div>
    </div>
  `,
  styleUrls: ['./live-rr-tracker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveRRTrackerComponent implements AfterViewInit, OnInit, OnChanges, OnDestroy {
  @Input() mt5LiveTrades: Table[] = [];
  @Input() tableData: Table[] = [];
  @Input() accountSize = 0;
  @Input() positiveGaugePercentMax = 4;
  @Input() liveTradeSoundSettings: LiveTradeSoundSettings = { enabled: true, alertThreshold: 2.8, highAlertThreshold: 3.4, volume: 0.7 };
  @Output() liveTradeSoundSettingsChange = new EventEmitter<LiveTradeSoundSettings>();
  @Output() gaugePercentMaxChange = new EventEmitter<number>();
  @ViewChildren('tradeGauge') tradeGaugeElements!: QueryList<ElementRef<HTMLDivElement>>;

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
  gaugePercentDraft = '4';
  isMaximized = false;
  soundSettingsDraft: LiveTradeSoundSettings = { enabled: true, alertThreshold: 2.8, highAlertThreshold: 3.4, volume: 0.7 };
  isGaugeSettingsOpen = false;
  private holdingTimeInterval?: ReturnType<typeof setInterval>;
  private tradeGaugeElementsSubscription?: Subscription;
  private readonly gaugeCharts = new Map<HTMLDivElement, echarts.ECharts>();
  private readonly gaugeResizeObservers = new Map<HTMLDivElement, ResizeObserver>();
  private closeAllConfirmationTimeout?: ReturnType<typeof setTimeout>;
  private previousBodyOverflow = '';

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
    this.holdingTimeInterval = setInterval(() => {
      this.updateTradeGauges();
      this.cdr.markForCheck();
    }, 1000);
  }

  ngAfterViewInit(): void {
    this.syncTradeGauges();
    this.tradeGaugeElementsSubscription = this.tradeGaugeElements.changes.subscribe(() => this.syncTradeGauges());
  }

  ngOnDestroy(): void {
    if (this.holdingTimeInterval) clearInterval(this.holdingTimeInterval);
    this.tradeGaugeElementsSubscription?.unsubscribe();
    this.disposeTradeGauges();
    if (this.closeAllConfirmationTimeout) clearTimeout(this.closeAllConfirmationTimeout);
    this.setBodyScrollLocked(false);
  }

  @HostListener('window:resize')
  resizeTradeGauges(): void {
    this.gaugeCharts.forEach(chart => chart.resize());
  }

  @HostListener('document:keydown.escape')
  closeMaximizedView(): void {
    if (this.isMaximized) {
      this.isMaximized = false;
      this.setBodyScrollLocked(false);
    }
  }

  toggleMaximize(): void {
    this.isMaximized = !this.isMaximized;
    this.setBodyScrollLocked(this.isMaximized);
    this.cdr.markForCheck();
  }

  private setBodyScrollLocked(locked: boolean): void {
    if (locked) {
      this.previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = this.previousBodyOverflow;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['positiveGaugePercentMax']) {
      const max = this.positiveGaugePercentMax;
      if (Number.isFinite(max) && max >= .1 && max <= 100) this.gaugePercentDraft = String(max);
    }

    if (changes['mt5LiveTrades'] || changes['tableData'] || changes['accountSize'] || changes['positiveGaugePercentMax']) {
      this.calculateLiveMetrics();
      this.updateTradeGauges();
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
    this.gaugePercentMaxChange.emit(nextMax);
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

  getTradeRiskPercent(trade: Table): number {
    const risk = this.getTradeRisk(trade);
    return this.accountSize > 0 ? (risk / this.accountSize) * 100 : 0;
  }

  getTradeRisk(trade: Table): number {
    return parseFloat(trade.riskPerTrade || '0') || 0;
  }

  getTradeMfeValue(trade: Table): number {
    return Math.max(0, Number(trade.mfe) || 0);
  }

  getTradeMaeValue(trade: Table): number {
    return Math.min(0, Number(trade.mae) || 0);
  }

  getTradeMfeR(trade: Table): number {
    const risk = this.getTradeRisk(trade);
    return risk > 0 ? this.getTradeMfeValue(trade) / risk : 0;
  }

  getTradeMaeR(trade: Table): number {
    const risk = this.getTradeRisk(trade);
    return risk > 0 ? this.getTradeMaeValue(trade) / risk : 0;
  }

  getTradeRClass(trade: Table): string {
    const value = this.getTradeR(trade);
    return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
  }

  getTradeRiskClass(trade: Table): string {
    return this.getTradeRiskPercent(trade) > 0 ? 'positive' : 'neutral';
  }

  trackByTrade(index: number, trade: Table): string | number {
    return trade.position || index;
  }

  private syncTradeGauges(): void {
    const gaugeElements = new Set(this.tradeGaugeElements.map(({ nativeElement }) => nativeElement));

    this.gaugeCharts.forEach((chart, element) => {
      if (!gaugeElements.has(element)) {
        this.gaugeResizeObservers.get(element)?.disconnect();
        this.gaugeResizeObservers.delete(element);
        chart.dispose();
        this.gaugeCharts.delete(element);
      }
    });

    Array.from(gaugeElements).forEach((element, index) => {
      if (this.gaugeCharts.has(element)) return;

      const trade = this.openTrades[index];
      if (!trade) return;

      const chart = echarts.init(element, undefined, { renderer: 'canvas' });
      this.gaugeCharts.set(element, chart);
      this.renderTradeGauge(chart, trade);

      const resizeObserver = new ResizeObserver(() => chart.resize());
      resizeObserver.observe(element);
      this.gaugeResizeObservers.set(element, resizeObserver);
    });
  }

  private updateTradeGauges(): void {
    this.tradeGaugeElements.forEach(({ nativeElement: element }, index) => {
      const chart = this.gaugeCharts.get(element);
      const trade = this.openTrades[index];
      if (chart && trade) this.renderTradeGauge(chart, trade);
    });
  }

  private renderTradeGauge(chart: echarts.ECharts, trade: Table): void {
    const state = this.getTradeGaugeState(trade);

    chart.setOption({
      series: [{
        type: 'gauge',
        startAngle: 90,
        endAngle: -270,
        center: ['50%', '50%'],
        radius: '65%',
        min: 0,
        max: 3,
        pointer: { show: false },
        progress: {
          show: true,
          overlap: false,
          roundCap: false,
          clip: false,
          itemStyle: {
            color: state.color,
            shadowBlur: state.glow.shadowBlur,
            shadowColor: state.glow.shadowColor,
          },
        },
        axisLine: {
          lineStyle: {
            width: 40,
            color: [[1, '#e5e7eb']],
          },
        },
        axisLabel: { show: false },
        splitLine: { show: false },
        axisTick: { show: false },
        clockwise: state.isPositive,
        data: [this.getGaugeData(state.value)],
        animationDuration: 700,
        animationDurationUpdate: 700,
        animationEasing: 'cubicInOut',
        animationEasingUpdate: 'cubicInOut',
        detail: {
          fontSize: 40,
          fontWeight: 'bold',
          color: state.color,
          valueAnimation: true,
          formatter: () => `${state.percentage.toFixed(2)}%`,
        },
      }],
    });
  }

  private getGaugeData(value: number) {
    return {
      value,
      detail: {
        valueAnimation: true,
        offsetCenter: ['0%', '0%'],
        fontSize: 40,
      },
    };
  }

  private getTradeGaugeState(trade: Table): {
    value: number;
    percentage: number;
    isPositive: boolean;
    color: string;
    glow: { shadowBlur: number; shadowColor: string };
  } {
    const percentage = this.getTradePercent(trade);
    const isPositive = percentage >= 0;
    const gaugeMaximum = isPositive ? this.positiveGaugePercentMax : 1;
    const fraction = gaugeMaximum > 0 ? Math.min(1, Math.abs(percentage) / gaugeMaximum) : 0;
    const value = Number((fraction * 3).toFixed(2));
    const color = percentage < 0 ? '#ef4444' : this.getPowerColor(value);
    const glow = this.getGlow(value);

    return {
      value,
      percentage,
      isPositive,
      color,
      glow: { ...glow, shadowColor: color },
    };
  }

  private getRadiantColor(value: number): string {
    const t = Math.max(0, Math.min(1, value / 3));
    let r: number;
    let g: number;
    let b: number;

    if (t < 0.5) {
      const p = t / 0.5;
      r = Math.round(134 + (34 - 134) * p);
      g = Math.round(239 + (211 - 239) * p);
      b = Math.round(172 + (238 - 172) * p);
    } else {
      const p = (t - 0.5) / 0.5;
      r = Math.round(34 + (0 - 34) * p);
      g = Math.round(211 + (191 - 211) * p);
      b = Math.round(238 + (255 - 238) * p);
    }

    return `rgb(${r}, ${g}, ${b})`;
  }

  private getPowerColor(value: number): string {
    const clampedValue = Math.max(0, Math.min(3, value));
    if (clampedValue <= 2.4) return this.getRadiantColor(clampedValue);

    const powerUp = Math.max(0, Math.min(1, (clampedValue - 2.4) / 0.6));
    const intensity = powerUp * powerUp;
    const match = this.getRadiantColor(2.4).match(/\d+/g)!;
    const startR = Number(match[0]);
    const startG = Number(match[1]);
    const startB = Number(match[2]);
    const targetR = 120;
    const targetG = 241;
    const targetB = 255;
    const r = Math.round(startR + (targetR - startR) * intensity);
    const g = Math.round(startG + (targetG - startG) * intensity);
    const b = Math.round(startB + (targetB - startB) * intensity);

    return `rgb(${r}, ${g}, ${b})`;
  }

  private getGlow(value: number): { shadowBlur: number; shadowColor: string } {
    const clampedValue = Math.max(0, Math.min(3, value));
    if (clampedValue <= 2.4) {
      const intensity = clampedValue / 2.4;
      return {
        shadowBlur: 5 + intensity * 10,
        shadowColor: this.getPowerColor(clampedValue),
      };
    }

    const powerUp = (clampedValue - 2.4) / 0.6;
    const intensity = powerUp * powerUp * powerUp;
    return {
      shadowBlur: 15 + intensity * 60,
      shadowColor: this.getPowerColor(clampedValue),
    };
  }

  private disposeTradeGauges(): void {
    this.gaugeResizeObservers.forEach(observer => observer.disconnect());
    this.gaugeResizeObservers.clear();
    this.gaugeCharts.forEach(chart => chart.dispose());
    this.gaugeCharts.clear();
  }

  getTradeR(trade: Table): number {
    const risk = parseFloat(trade.riskPerTrade || '0') || 0;
    if (risk > 0) return this.getTradeProfit(trade) / risk;

    const reportedR = parseFloat(String(trade.rrr || '').replace('R', ''));
    return Number.isFinite(reportedR) ? reportedR : 0;
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
}
