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
                  <span>Live P&L</span>
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
            <div class="metric-subtext">
              <span *ngIf="totalRRValue >= 0" class="positive-indicator">
                +{{ (totalRRValue * 100).toFixed(1) }}% Risk
              </span>
              <span *ngIf="totalRRValue < 0" class="negative-indicator">
                {{ (totalRRValue * 100).toFixed(1) }}% Risk
              </span>
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
                Potential Gain
              </span>
              <span *ngIf="percentageOfAccount < 0" class="negative-indicator">
                Potential Loss
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
            <div class="metric-subtext">
              <span *ngIf="totalUnrealizedValue >= 0" class="positive-indicator">
                {{ ((totalUnrealizedValue / 2500) * 100).toFixed(2) }}% of Account
              </span>
              <span *ngIf="totalUnrealizedValue < 0" class="negative-indicator">
                {{ ((totalUnrealizedValue / 2500) * 100).toFixed(2) }}% of Account
              </span>
            </div>
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

  hasLiveTrades: boolean = false;
  openTradeCount: number = 0;
  totalRRGained: string = '+0.00R';
  totalRRValue: number = 0;
  percentageOfAccount: number = 0;
  totalUnrealizedPnL: string = '$0.00';
  totalUnrealizedValue: number = 0;

  readonly PROP_FIRM_ACCOUNT_VALUE = 2500;

  ngOnInit() {
    console.log('🚀 LiveRRTrackerComponent initialized');
    this.calculateLiveMetrics();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['mt5LiveTrades']) {
      console.log('📊 mt5LiveTrades changed:', {
        newLength: changes['mt5LiveTrades'].currentValue?.length || 0,
        trades: changes['mt5LiveTrades'].currentValue || []
      });
      this.calculateLiveMetrics();
    }
  }

  calculateLiveMetrics(): void {
    console.log('📈 Starting calculateLiveMetrics with', this.mt5LiveTrades.length, 'trades');
    console.log('📋 Trades data:', this.mt5LiveTrades);

    // Filter only open trades (either mt5status is OPEN or closeDate not set/is placeholder)
    const openTrades = this.mt5LiveTrades.filter(trade => {
      const isOpen = trade.mt5status === 'OPEN' || (trade.closeDate === '-' || !trade.closeDate);
      console.log(`🔍 Trade ${trade.symbol}: closeDate="${trade.closeDate}", mt5status="${trade.mt5status}", isOpen=${isOpen}`);
      return isOpen;
    });

    this.hasLiveTrades = openTrades.length > 0;
    this.openTradeCount = openTrades.length;
    console.log('✅ Open trades found:', openTrades.length, 'Has live trades:', this.hasLiveTrades);

    if (!this.hasLiveTrades) {
      this.resetMetrics();
      return;
    }

    // Calculate total RR
    let totalR = 0;
    let totalUnrealizedPnL = 0;

    console.log('🧮 Calculating metrics for', openTrades.length, 'open trades:');
    openTrades.forEach((trade, idx) => {
      // Extract RR value from trade.rrr (which is now real-time live RR)
      const rValue = parseFloat(trade.rrr?.replace('R', '')?.replace(/^\+/, '') || '0');
      totalR += rValue;

      // Calculate unrealized P&L
      const profit = parseFloat(trade.profit || '0');
      totalUnrealizedPnL += profit;

      console.log(`   Trade ${idx + 1} (${trade.symbol}): RR=${rValue.toFixed(2)}R, Profit=$${profit.toFixed(2)}`);
    });

    console.log('📊 Total metrics: TotalR=' + totalR.toFixed(2) + 'R, TotalP&L=$' + totalUnrealizedPnL.toFixed(2));

    this.totalRRValue = totalR;
    this.totalRRGained = totalR >= 0 ? `+${totalR.toFixed(2)}R` : `${totalR.toFixed(2)}R`;
    this.percentageOfAccount = parseFloat(((totalR / this.PROP_FIRM_ACCOUNT_VALUE) * 100).toFixed(2));
    this.totalUnrealizedValue = totalUnrealizedPnL;
    this.totalUnrealizedPnL = this.formatCurrency(totalUnrealizedPnL);

    console.log('✅ LIVE METRICS UPDATED:');
    console.log('   - Total RR Gained:', this.totalRRGained);
    console.log('   - Account Risk %:', this.percentageOfAccount + '%');
    console.log('   - Unrealized P&L:', this.totalUnrealizedPnL);
  }

  resetMetrics(): void {
    this.totalRRGained = '+0.00R';
    this.totalRRValue = 0;
    this.percentageOfAccount = 0;
    this.totalUnrealizedPnL = '$0.00';
    this.totalUnrealizedValue = 0;
  }

  formatCurrency(amount: number): string {
    const absAmount = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    if (absAmount >= 1000) {
      return `${sign}$${(absAmount / 1000).toFixed(1)}K`;
    }
    return `${sign}$${absAmount.toFixed(0)}`;
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
