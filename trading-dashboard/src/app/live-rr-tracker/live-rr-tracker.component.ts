import { Component, Input, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

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
}

@Component({
  selector: 'app-live-rr-tracker',
  standalone: true,
  imports: [CommonModule, MatIconModule],
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
              <!-- Description -->
              <p class="empty-description">
                No live trades at the moment. Once you open a trade, your real-time Risk-Reward ratio and gains will appear here.
              </p>

              <!-- Quick Stats Preview -->
              <div class="preview-stats">
                <div class="stat-badge">
                  <mat-icon>show_chart</mat-icon>
                  <span>Real-time RR</span>
                </div>
                <div class="stat-badge">
                  <mat-icon>trending_up</mat-icon>
                  <span>Use P&L</span>
                </div>
                <div class="stat-badge">
                  <mat-icon>speed</mat-icon>
                  <span>Instant</span>
                </div>
              </div>

              <!-- Connection Status -->
              <div class="connection-indicator">
                <span class="status-dot"></span>
                <span class="status-text">Waiting for trades...</span>
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
            <h3>Live Trading Session</h3>
          </div>
          <div class="header-meta">
            <span class="trade-count">{{ openTradeCount }} Trade<span *ngIf="openTradeCount !== 1">s</span> Open</span>
          </div>
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
            <div class="metric-subtext">
              <span *ngIf="percentageOfAccount >= 0" class="positive-indicator">
                At Risk
              </span>
              <span *ngIf="percentageOfAccount < 0" class="negative-indicator">
                At Risk
              </span>
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

        <div class="live-trade-gauges">
          <article *ngFor="let trade of openTrades" class="trade-gauge-card">
            <div class="trade-gauge-heading">
              <span class="trade-gauge-symbol">{{ trade.symbol }}</span>
            </div>
            <div class="trade-gauge-content">
              <div class="trade-gauge" [attr.aria-label]="trade.symbol + ' unrealized P&L gauge'">
                <svg viewBox="0 0 100 100" class="trade-gauge-svg">
                  <circle cx="50" cy="50" r="44" fill="none" stroke="#e5e7eb" stroke-width="10"/>
                  <circle cx="50" cy="50" r="44" fill="none" [attr.stroke]="getTradeGaugeColor(trade)" stroke-width="10" stroke-linecap="butt"
                          [attr.stroke-dasharray]="getTradeGaugeDash(trade)" transform="rotate(-90 50 50)"/>
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

        <!-- Status Bar -->
        <div class="status-bar">
          <div class="status-item">
            <span class="status-label">Status</span>
            <span class="status-badge active">
              <mat-icon class="pulse-dot">fiber_manual_record</mat-icon>
              Live Trading
            </span>
          </div>
          <div class="status-item">
            <span class="status-label">Last Update</span>
            <span class="status-time">Real-time</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./live-rr-tracker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveRRTrackerComponent implements OnInit, OnChanges {
  @Input() mt5LiveTrades: Table[] = [];
  @Input() tableData: Table[] = [];
  @Input() accountSize = 0;

  hasLiveTrades: boolean = false;
  openTradeCount: number = 0;
  openTrades: Table[] = [];
  totalRRGained: string = '+0.00R';
  totalRRValue: number = 0;
  percentageOfAccount: number = 0;
  totalUnrealizedPnL: string = '$0.00';
  totalUnrealizedValue: number = 0;

  ngOnInit() {
    this.calculateLiveMetrics();
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

    openTrades.forEach((trade) => {
      const profit = parseFloat(trade.profit || '0') || 0;
      const slRisk = parseFloat(trade.riskPerTrade || '0') || 0;
      totalR += slRisk > 0 ? profit / slRisk : 0;
      totalUnrealizedPnL += profit;
      totalSlRisk += slRisk;
    });

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
    this.openTrades = [];
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
    const fraction = Math.min(1, Math.abs(this.getTradePercent(trade)) / 4);
    const arc = fraction * circumference;
    return `${arc} ${Math.max(0, circumference - arc)}`;
  }

  getTradeGaugeColor(trade: Table): string {
    return this.getTradeProfit(trade) < 0 ? '#ef4444' : '#10b981';
  }

  getTradePnLClass(trade: Table): string {
    if (this.getTradeProfit(trade) > 0) return 'positive';
    if (this.getTradeProfit(trade) < 0) return 'negative';
    return 'neutral';
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
