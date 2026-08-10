import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import * as echarts from 'echarts';
import type { ECharts, EChartsOption } from 'echarts';

export interface AccountEquityPoint {
  timestamp: string;
  balance: number;
  equity: number;
  floatingPnL?: number;
}

export interface AccountTradeMarker {
  timestamp: string;
  tradeId?: string | number;
  symbol?: string;
  side?: string;
  volume?: string | number;
  pnl: number;
  rrr?: string | number;
  risk?: string | number;
  openedAt?: string;
  closedAt?: string;
  result: 'win' | 'loss' | 'open';
  equity: number;
}

export interface PropFirmRules {
  startingBalance: number;
  profitTargetPercent: number;
  maxDrawdownPercent: number;
  dailyLossPercent: number;
}

type AccountState = 'normal' | 'near-target' | 'target-reached' | 'near-drawdown' | 'drawdown-breached';

@Component({
  selector: 'app-prop-firm-equity-chart',
  standalone: true,
  templateUrl: './prop-firm-equity-chart.component.html',
  styleUrl: './prop-firm-equity-chart.component.scss'
})
export class PropFirmEquityChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) points: AccountEquityPoint[] = [];
  @Input({ required: true }) tradeMarkers: AccountTradeMarker[] = [];
  @Input({ required: true }) rules: PropFirmRules = {
    startingBalance: 0,
    profitTargetPercent: 0,
    maxDrawdownPercent: 0,
    dailyLossPercent: 0
  };
  @Input() dailyPnL = 0;
  @Input() isLive = false;
  @Input() isDarkTheme = false;
  @Input() isLoading = false;

  @ViewChild('chartHost') private chartHost?: ElementRef<HTMLDivElement>;

  chartState: AccountState = 'normal';
  private chart?: ECharts;
  private resizeObserver?: ResizeObserver;
  private renderFrame?: number;

  ngAfterViewInit(): void {
    const host = this.chartHost?.nativeElement;
    if (!host) return;

    this.chart = echarts.init(host, undefined, { renderer: 'canvas' });
    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(host);
    this.renderChart();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.chartState = this.getAccountState();
    this.queueRender();
  }

  ngOnDestroy(): void {
    if (this.renderFrame !== undefined) cancelAnimationFrame(this.renderFrame);
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }

  get statusLabel(): string {
    const labels: Record<AccountState, string> = {
      normal: 'On track',
      'near-target': 'Near target',
      'target-reached': 'Target reached',
      'near-drawdown': 'Drawdown alert',
      'drawdown-breached': 'Drawdown breached'
    };
    return labels[this.chartState];
  }

  get currentPoint(): AccountEquityPoint | undefined {
    return this.points.at(-1);
  }

  private queueRender(): void {
    if (this.renderFrame !== undefined) cancelAnimationFrame(this.renderFrame);
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = undefined;
      this.renderChart();
    });
  }

  private renderChart(): void {
    if (!this.chart) return;

    const palette = this.isDarkTheme
      ? {
          text: '#e2e8f0', muted: '#94a3b8', grid: 'rgba(148, 163, 184, 0.12)',
          surface: 'rgba(15, 23, 42, 0.96)', border: 'rgba(167, 139, 250, 0.2)'
        }
      : {
          text: '#1e293b', muted: '#64748b', grid: 'rgba(100, 116, 139, 0.13)',
          surface: 'rgba(15, 23, 42, 0.96)', border: 'rgba(196, 181, 253, 0.35)'
        };
    const thresholds = this.getThresholds();
    const range = this.getVisibleRange(thresholds);
    const hasData = this.points.length > 0;
    const latest = this.currentPoint;
    const chartPoints = this.points.map(point => [point.timestamp, point.equity]);
    const balancePoints = this.points.map(point => [point.timestamp, point.balance]);
    const markerData = (result: AccountTradeMarker['result']) => this.tradeMarkers
      .filter(marker => marker.result === result)
      .map(marker => ({
        value: [marker.timestamp, marker.equity],
        marker
      }));

    const option: EChartsOption = {
      animation: true,
      animationDuration: 550,
      animationDurationUpdate: 280,
      backgroundColor: 'transparent',
      grid: { top: 42, right: 28, bottom: 38, left: 72, containLabel: false },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        axisLine: { lineStyle: { color: palette.grid } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: palette.muted,
          fontSize: 11,
          hideOverlap: true,
          formatter: (value: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value))
        }
      },
      yAxis: {
        type: 'value',
        min: range.min,
        max: range.max,
        scale: true,
        splitNumber: 5,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: palette.muted,
          fontSize: 11,
          formatter: (value: number) => this.formatCompactCurrency(value)
        },
        splitLine: { lineStyle: { color: palette.grid, type: 'dashed' } }
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        padding: 0,
        textStyle: { color: palette.text },
        extraCssText: 'border-radius: 12px; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.28); backdrop-filter: blur(16px);',
        formatter: (params: unknown) => this.formatTooltip(Array.isArray(params) ? params : [params])
      },
      series: hasData ? [
        {
          name: 'Equity',
          type: 'line',
          data: chartPoints,
          smooth: 0.22,
          showSymbol: false,
          symbol: 'circle',
          lineStyle: { width: 3, color: '#8b5cf6', shadowBlur: 12, shadowColor: 'rgba(139, 92, 246, 0.32)' },
          itemStyle: { color: '#a78bfa' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(139, 92, 246, 0.3)' },
              { offset: 0.8, color: 'rgba(139, 92, 246, 0.04)' },
              { offset: 1, color: 'rgba(139, 92, 246, 0)' }
            ])
          },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: true, position: 'insideEndTop', fontSize: 10, padding: [2, 5], borderRadius: 4 },
            data: this.getReferenceLines(thresholds)
          }
        },
        {
          name: 'Balance',
          type: 'line',
          data: balancePoints,
          smooth: 0.12,
          showSymbol: false,
          silent: true,
          lineStyle: { width: 1.3, type: 'dashed', color: 'rgba(45, 212, 191, 0.75)' },
          itemStyle: { color: '#2dd4bf' },
          z: 2
        },
        this.getTradeSeries('Wins', markerData('win'), '#34d399'),
        this.getTradeSeries('Losses', markerData('loss'), '#fb7185'),
        this.getTradeSeries('Open trade', markerData('open'), '#fbbf24'),
        ...(latest ? [this.getCurrentSeries(latest)] : [])
      ] : []
    };

    this.chart.setOption(option, { notMerge: true, lazyUpdate: true });
  }

  private getTradeSeries(name: string, data: { value: [string, number]; marker: AccountTradeMarker }[], color: string): object {
    return {
      name,
      type: 'scatter',
      data,
      symbolSize: 9,
      itemStyle: { color, borderColor: this.isDarkTheme ? '#0f172a' : '#ffffff', borderWidth: 2, shadowBlur: 8, shadowColor: `${color}55` },
      z: 5
    };
  }

  private getCurrentSeries(latest: AccountEquityPoint): object {
    return {
      name: 'Current equity',
      type: this.isLive ? 'effectScatter' : 'scatter',
      data: [[latest.timestamp, latest.equity]],
      symbolSize: 14,
      showEffectOn: 'render',
      rippleEffect: { period: 5, scale: 2.2, brushType: 'stroke' },
      itemStyle: {
        color: this.chartState === 'drawdown-breached' || this.chartState === 'near-drawdown' ? '#fb7185' : '#a78bfa',
        borderColor: '#ffffff',
        borderWidth: 3,
        shadowBlur: 18,
        shadowColor: this.isLive ? 'rgba(167, 139, 250, 0.7)' : 'rgba(139, 92, 246, 0.42)'
      },
      label: {
        show: true,
        position: 'right',
        distance: 9,
        color: this.isDarkTheme ? '#f8fafc' : '#334155',
        fontSize: 10,
        fontWeight: 700,
        formatter: this.isLive ? 'LIVE' : 'CURRENT'
      },
      z: 7
    };
  }

  private getReferenceLines(thresholds: ReturnType<PropFirmEquityChartComponent['getThresholds']>): object[] {
    const reference = (name: string, value: number, color: string, type: 'solid' | 'dashed' = 'dashed') => ({
      name,
      yAxis: value,
      lineStyle: { color, width: 1, type, opacity: 0.65 },
      label: { color, backgroundColor: this.isDarkTheme ? 'rgba(15, 23, 42, 0.82)' : 'rgba(255, 255, 255, 0.9)', formatter: `${name}  ${this.formatCompactCurrency(value)}` }
    });

    return [
      reference('Profit target', thresholds.profitTarget, '#34d399'),
      reference('Starting balance', thresholds.startingBalance, '#a78bfa', 'solid'),
      reference('Max drawdown', thresholds.maxDrawdown, '#fb7185'),
      reference('Daily loss limit', thresholds.dailyLoss, '#f59e0b')
    ];
  }

  private getThresholds(): { startingBalance: number; profitTarget: number; maxDrawdown: number; dailyLoss: number } {
    const startingBalance = this.asFiniteNumber(this.rules.startingBalance);
    return {
      startingBalance,
      profitTarget: startingBalance * (1 + this.asFiniteNumber(this.rules.profitTargetPercent) / 100),
      maxDrawdown: startingBalance * (1 - this.asFiniteNumber(this.rules.maxDrawdownPercent) / 100),
      dailyLoss: startingBalance * (1 - this.asFiniteNumber(this.rules.dailyLossPercent) / 100)
    };
  }

  private getVisibleRange(thresholds: ReturnType<PropFirmEquityChartComponent['getThresholds']>): { min: number; max: number } {
    const values = [
      ...this.points.flatMap(point => [point.balance, point.equity]),
      thresholds.startingBalance,
      thresholds.profitTarget,
      thresholds.maxDrawdown,
      thresholds.dailyLoss
    ].filter(Number.isFinite);
    const lower = Math.min(...values);
    const upper = Math.max(...values);
    const span = Math.max(upper - lower, Math.abs(thresholds.startingBalance) * 0.04, 1);
    const padding = Math.max(span * 0.14, Math.abs(thresholds.startingBalance) * 0.0125, 1);
    return { min: lower - padding, max: upper + padding };
  }

  private getAccountState(): AccountState {
    const latestEquity = this.currentPoint?.equity;
    if (!Number.isFinite(latestEquity)) return 'normal';

    const thresholds = this.getThresholds();
    if (latestEquity >= thresholds.profitTarget) return 'target-reached';
    if (latestEquity <= thresholds.maxDrawdown) return 'drawdown-breached';

    const targetDistance = thresholds.profitTarget - thresholds.startingBalance;
    const drawdownDistance = thresholds.startingBalance - thresholds.maxDrawdown;
    if (targetDistance > 0 && latestEquity >= thresholds.profitTarget - targetDistance * 0.1) return 'near-target';
    if (drawdownDistance > 0 && latestEquity <= thresholds.maxDrawdown + drawdownDistance * 0.15) return 'near-drawdown';
    return 'normal';
  }

  private formatTooltip(params: any[]): string {
    const equityParam = params.find(param => param.seriesName === 'Equity');
    const markerParam = params.find(param => ['Wins', 'Losses', 'Open trade'].includes(param.seriesName));
    const timestamp = equityParam?.value?.[0] ?? markerParam?.value?.[0];
    const point = this.points.find(candidate => candidate.timestamp === timestamp);
    const marker = markerParam?.data?.marker as AccountTradeMarker | undefined;
    const title = timestamp
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp)).toUpperCase()
      : 'ACCOUNT STATUS';

    if (marker) return this.formatTradeTooltip(title, marker, point);
    if (!point) return '';

    const floating = point.floatingPnL ?? point.equity - point.balance;
    return `<div class="aura-chart-tooltip"><div class="aura-chart-tooltip__time">${title}</div><div class="aura-chart-tooltip__value"><span>Equity</span><strong>${this.formatCurrency(point.equity)}</strong></div><div class="aura-chart-tooltip__row"><span>Balance</span><b>${this.formatCurrency(point.balance)}</b></div>${this.isLive ? `<div class="aura-chart-tooltip__row"><span>Floating P&L</span><b class="${floating >= 0 ? 'is-positive' : 'is-negative'}">${this.formatSignedCurrency(floating)}</b></div>` : ''}<div class="aura-chart-tooltip__row"><span>Daily P&L</span><b class="${this.dailyPnL >= 0 ? 'is-positive' : 'is-negative'}">${this.formatSignedCurrency(this.dailyPnL)}</b></div></div>`;
  }

  private formatTradeTooltip(title: string, marker: AccountTradeMarker, point?: AccountEquityPoint): string {
    const details = [
      marker.symbol,
      marker.side,
      marker.volume !== undefined && marker.volume !== '' ? `${this.escape(marker.volume)} lots` : ''
    ].filter(Boolean).join(' · ');
    const fields = [
      ['P&L', this.formatSignedCurrency(marker.pnl), marker.pnl >= 0 ? 'is-positive' : 'is-negative'],
      marker.rrr !== undefined && marker.rrr !== '' ? ['R:R', `${this.escape(marker.rrr)}R`, ''] : null,
      marker.risk !== undefined && marker.risk !== '' && Number(marker.risk) > 0 ? ['Risk', this.formatCurrency(Number(marker.risk)), ''] : null,
      marker.openedAt ? ['Open', this.escape(marker.openedAt), ''] : null,
      marker.closedAt ? ['Close', this.escape(marker.closedAt), ''] : null,
      point ? ['Equity', this.formatCurrency(point.equity), ''] : null
    ].filter((field): field is [string, string, string] => field !== null);

    return `<div class="aura-chart-tooltip"><div class="aura-chart-tooltip__time">${title}</div><div class="aura-chart-tooltip__trade">${marker.tradeId !== undefined ? `Trade #${this.escape(marker.tradeId)}` : 'Trade'}</div>${details ? `<div class="aura-chart-tooltip__meta">${this.escape(details)}</div>` : ''}${fields.map(([label, value, className]) => `<div class="aura-chart-tooltip__row"><span>${label}</span><b class="${className}">${value}</b></div>`).join('')}</div>`;
  }

  private asFiniteNumber(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }

  private formatSignedCurrency(value: number): string {
    return `${value >= 0 ? '+' : '-'}${this.formatCurrency(Math.abs(value))}`;
  }

  private formatCompactCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  }

  private escape(value: string | number): string {
    return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character);
  }
}
