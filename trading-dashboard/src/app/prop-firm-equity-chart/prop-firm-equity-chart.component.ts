import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, SimpleChanges, ViewChild, ViewEncapsulation } from '@angular/core';
import { NgClass } from '@angular/common';
import { init, use, type ECharts, type EChartsCoreOption } from 'echarts/core';
import { LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

use([LineChart, ScatterChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface AccountEquityTrade {
  id?: string;
  symbol?: string;
  side?: string;
  lots?: number;
  pnl?: number;
  risk?: number;
  rr?: number;
  openTime?: string;
  closeTime?: string;
}

export interface AccountEquityPoint {
  timestamp: string;
  balance: number;
  equity: number;
  floatingPnL?: number;
  dailyPnL?: number;
  tradeId?: string;
  tradeResult?: 'win' | 'loss' | 'open';
  trade?: AccountEquityTrade;
}

export interface AccountEquityThresholds {
  startingBalance: number;
  profitTarget?: number;
  maxDrawdown?: number;
  dailyLossLimit?: number;
}

export interface AccountEquityChartModel {
  points: AccountEquityPoint[];
  thresholds: AccountEquityThresholds;
  hasTrades: boolean;
  hasLiveTrade: boolean;
}

@Component({
  selector: 'app-prop-firm-equity-chart',
  standalone: true,
  imports: [NgClass],
  templateUrl: './prop-firm-equity-chart.component.html',
  styleUrl: './prop-firm-equity-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None
})
export class PropFirmEquityChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) model: AccountEquityChartModel = {
    points: [],
    thresholds: { startingBalance: 0 },
    hasTrades: false,
    hasLiveTrade: false
  };
  @Input() isLoading = false;

  @ViewChild('chartHost') private chartHost?: ElementRef<HTMLDivElement>;

  private chart?: ECharts;
  private resizeObserver?: ResizeObserver;
  private themeObserver?: MutationObserver;
  private initialized = false;

  constructor(private zone: NgZone) {}

  get accountState(): string {
    const latest = this.latestPoint;
    if (!latest || !this.model.hasTrades) return 'Awaiting trades';

    const { profitTarget, maxDrawdown, startingBalance } = this.model.thresholds;
    if (Number.isFinite(maxDrawdown) && latest.equity <= Number(maxDrawdown)) return 'Drawdown breached';
    if (Number.isFinite(profitTarget) && latest.equity >= Number(profitTarget)) return 'Target reached';
    if (Number.isFinite(maxDrawdown) && latest.equity - Number(maxDrawdown) <= Math.max(startingBalance * 0.04, 1)) return 'Near drawdown';
    if (Number.isFinite(profitTarget) && Number(profitTarget) > startingBalance && (latest.equity - startingBalance) / (Number(profitTarget) - startingBalance) >= 0.85) return 'Near profit target';
    return this.model.hasLiveTrade ? 'Live position' : 'On track';
  }

  get accountStateTone(): 'positive' | 'warning' | 'danger' | 'neutral' {
    if (this.accountState === 'Target reached') return 'positive';
    if (this.accountState === 'Near drawdown' || this.accountState === 'Near profit target') return 'warning';
    if (this.accountState === 'Drawdown breached') return 'danger';
    return 'neutral';
  }

  ngAfterViewInit(): void {
    this.initialized = true;
    this.zone.runOutsideAngular(() => {
      this.chart = init(this.chartHost!.nativeElement, undefined, { renderer: 'canvas' });
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(this.chartHost!.nativeElement);
      this.themeObserver = new MutationObserver(() => this.renderChart());
      this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      this.renderChart();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.initialized && (changes['model'] || changes['isLoading'])) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.chart?.dispose();
  }

  private get latestPoint(): AccountEquityPoint | undefined {
    return this.model.points[this.model.points.length - 1];
  }

  private renderChart(): void {
    if (!this.chart) return;

    const points = this.model.points;
    const latest = this.latestPoint;
    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#c4b5fd' : '#52627a';
    const gridColor = isDark ? 'rgba(167, 139, 250, 0.14)' : 'rgba(100, 116, 139, 0.12)';
    const surface = isDark ? '#111827' : '#ffffff';
    const [axisMin, axisMax] = this.getAxisRange(points);
    const lineData = points.map(point => ({ value: [new Date(point.timestamp).getTime(), point.equity], point }));
    const balanceData = points.map(point => ({ value: [new Date(point.timestamp).getTime(), point.balance], point }));
    const tradeData = points
      .filter(point => point.tradeId && (point.tradeResult === 'win' || point.tradeResult === 'loss'))
      .map(point => ({
        value: [new Date(point.timestamp).getTime(), point.equity],
        point,
        itemStyle: { color: point.tradeResult === 'win' ? '#22c55e' : '#f87171' }
      }));

    const markLines = this.getMarkLines();
    const latestData = latest ? [{ value: [new Date(latest.timestamp).getTime(), latest.equity], point: latest }] : [];
    const option: EChartsCoreOption = {
      animation: true,
      animationDuration: 520,
      animationDurationUpdate: 360,
      grid: { top: 34, right: 18, bottom: 35, left: 60, containLabel: false },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: textColor, fontSize: 11, hideOverlap: true, formatter: (value: number) => this.formatAxisDate(value) }
      },
      yAxis: {
        type: 'value',
        min: axisMin,
        max: axisMax,
        splitNumber: 5,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
        axisLabel: { color: textColor, fontSize: 11, formatter: (value: number) => this.formatCompactCurrency(value) }
      },
      tooltip: {
        trigger: 'axis',
        appendToBody: true,
        className: 'aura-equity-tooltip',
        backgroundColor: surface,
        borderColor: isDark ? 'rgba(167, 139, 250, 0.28)' : 'rgba(109, 40, 217, 0.18)',
        borderWidth: 1,
        padding: 0,
        extraCssText: `box-shadow: 0 18px 45px ${isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(76, 29, 149, 0.16)'}; border-radius: 12px;`,
        axisPointer: { type: 'line', lineStyle: { color: isDark ? 'rgba(196, 181, 253, 0.42)' : 'rgba(109, 40, 217, 0.3)', type: 'dashed' } },
        formatter: (params: any) => this.renderTooltip(Array.isArray(params) ? params : [params])
      },
      series: [
        {
          name: 'Equity',
          type: 'line',
          data: lineData,
          smooth: 0.24,
          showSymbol: false,
          symbol: 'circle',
          lineStyle: { color: '#8b5cf6', width: 3, shadowBlur: 12, shadowColor: 'rgba(139, 92, 246, 0.32)' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(139, 92, 246, 0.29)' },
                { offset: 1, color: 'rgba(139, 92, 246, 0.015)' }
              ]
            }
          },
          emphasis: { focus: 'series', lineStyle: { width: 4 } },
          markLine: { symbol: 'none', silent: true, data: markLines }
        },
        {
          name: 'Balance',
          type: 'line',
          data: balanceData,
          smooth: 0.16,
          showSymbol: false,
          lineStyle: { color: isDark ? 'rgba(196, 181, 253, 0.68)' : 'rgba(109, 40, 217, 0.55)', width: 1.35, type: 'dashed' },
          emphasis: { focus: 'series' }
        },
        {
          name: 'Closed trade',
          type: 'scatter',
          data: tradeData,
          symbolSize: 8,
          itemStyle: { borderColor: surface, borderWidth: 2, shadowBlur: 8, shadowColor: 'rgba(15, 23, 42, 0.2)' },
          z: 4
        },
        {
          name: 'Current equity',
          type: 'scatter',
          data: latestData,
          symbolSize: this.model.hasLiveTrade ? 15 : 12,
          itemStyle: { color: '#a78bfa', borderColor: surface, borderWidth: 3, shadowBlur: 18, shadowColor: 'rgba(139, 92, 246, 0.7)' },
          label: {
            show: true,
            position: 'right',
            distance: 8,
            color: isDark ? '#ede9fe' : '#5b21b6',
            fontSize: 11,
            fontWeight: 700,
            formatter: this.model.hasLiveTrade ? 'LIVE  {value|{c}}' : '{value|{c}}',
            rich: { value: { fontWeight: 700 } }
          },
          z: 6
        }
      ]
    };

    this.chart.setOption(option, { notMerge: true, lazyUpdate: true });
  }

  private getMarkLines(): any[] {
    const { startingBalance, profitTarget, maxDrawdown, dailyLossLimit } = this.model.thresholds;
    const lines = [
      this.makeMarkLine('Starting balance', startingBalance, '#818cf8'),
      Number.isFinite(profitTarget) ? this.makeMarkLine('Profit target', Number(profitTarget), '#34d399') : null,
      Number.isFinite(maxDrawdown) ? this.makeMarkLine('Max drawdown', Number(maxDrawdown), '#fb7185') : null,
      Number.isFinite(dailyLossLimit) ? this.makeMarkLine('Daily loss limit', Number(dailyLossLimit), '#fbbf24') : null
    ];
    return lines.filter(Boolean);
  }

  private makeMarkLine(name: string, value: number, color: string): any {
    return {
      name,
      yAxis: value,
      lineStyle: { color, width: 1, type: 'dashed', opacity: 0.65 },
      label: {
        show: true,
        position: 'insideStartTop',
        color,
        fontSize: 10,
        fontWeight: 600,
        formatter: `${name}  ${this.formatCurrency(value)}`
      }
    };
  }

  private getAxisRange(points: AccountEquityPoint[]): [number, number] {
    const values = [
      ...points.flatMap(point => [point.balance, point.equity]),
      this.model.thresholds.startingBalance,
      this.model.thresholds.profitTarget,
      this.model.thresholds.maxDrawdown,
      this.model.thresholds.dailyLossLimit
    ].filter((value): value is number => Number.isFinite(value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, Math.abs(this.model.thresholds.startingBalance) * 0.012, 1);
    const padding = Math.max(span * 0.18, Math.abs(this.model.thresholds.startingBalance) * 0.006, 1);
    return [min - padding, max + padding];
  }

  private renderTooltip(params: any[]): string {
    const point = params.map(param => param.data?.point as AccountEquityPoint | undefined).find(Boolean);
    if (!point) return '';

    const rows = [
      this.tooltipRow('Equity', this.formatCurrency(point.equity), 'aura-equity-tooltip__main'),
      this.tooltipRow('Balance', this.formatCurrency(point.balance)),
      Number.isFinite(point.floatingPnL) ? this.tooltipRow('Floating P&L', this.formatSignedCurrency(Number(point.floatingPnL)), Number(point.floatingPnL) >= 0 ? 'aura-equity-tooltip__positive' : 'aura-equity-tooltip__negative') : '',
      Number.isFinite(point.dailyPnL) ? this.tooltipRow('Daily P&L', this.formatSignedCurrency(Number(point.dailyPnL)), Number(point.dailyPnL) >= 0 ? 'aura-equity-tooltip__positive' : 'aura-equity-tooltip__negative') : ''
    ].join('');

    return `<div class="aura-equity-tooltip__content"><div class="aura-equity-tooltip__time">${this.escapeHtml(this.formatTooltipDate(point.timestamp))}</div><div class="aura-equity-tooltip__divider"></div>${rows}${this.renderTradeDetails(point.trade)}</div>`;
  }

  private renderTradeDetails(trade?: AccountEquityTrade): string {
    if (!trade) return '';
    const rows = [
      trade.id ? this.tooltipRow('Trade', `#${this.escapeHtml(trade.id)}`) : '',
      trade.symbol ? this.tooltipRow('Instrument', this.escapeHtml(trade.symbol)) : '',
      trade.side ? this.tooltipRow('Side', this.escapeHtml(trade.side)) : '',
      Number.isFinite(trade.lots) ? this.tooltipRow('Size', `${trade.lots} lots`) : '',
      Number.isFinite(trade.pnl) ? this.tooltipRow('Trade P&L', this.formatSignedCurrency(Number(trade.pnl)), Number(trade.pnl) >= 0 ? 'aura-equity-tooltip__positive' : 'aura-equity-tooltip__negative') : '',
      Number.isFinite(trade.rr) ? this.tooltipRow('R:R', `${trade.rr}R`) : '',
      Number.isFinite(trade.risk) ? this.tooltipRow('Risk', this.formatCurrency(Number(trade.risk))) : '',
      trade.openTime ? this.tooltipRow('Open', this.escapeHtml(this.formatTooltipDate(trade.openTime))) : '',
      trade.closeTime ? this.tooltipRow('Close', this.escapeHtml(this.formatTooltipDate(trade.closeTime))) : ''
    ].join('');
    return rows ? `<div class="aura-equity-tooltip__divider"></div>${rows}` : '';
  }

  private tooltipRow(label: string, value: string, valueClass = ''): string {
    return `<div class="aura-equity-tooltip__row"><span>${this.escapeHtml(label)}</span><strong class="${valueClass}">${value}</strong></div>`;
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }

  private formatSignedCurrency(value: number): string {
    return `${value >= 0 ? '+' : '-'}${this.formatCurrency(Math.abs(value))}`;
  }

  private formatCompactCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  private formatAxisDate(timestamp: number): string {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(timestamp));
  }

  private formatTooltipDate(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
  }
}
