import {
  Component,
  ElementRef,
  Inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import * as echarts from 'echarts';

/**
 * Normalized account-equity data point.
 *
 * The chart component never queries Supabase nor owns trading calculations —
 * it only visualises the data it is handed by the dashboard data layer.
 */
export interface AccountEquityPoint {
  timestamp: string;
  balance: number;
  equity: number;
  floatingPnL?: number;
  tradeId?: string;
  tradeResult?: 'win' | 'loss' | 'open';
  /** Only populated when the source trade actually exposes the field. */
  symbol?: string;
  type?: string;
  volume?: string;
  risk?: number;
  rr?: string;
  openTime?: string;
  closeTime?: string;
  pnl?: number;
  dailyPnl?: number;
}

/** Prop-firm reference levels + current status, computed by the data layer. */
export interface PropFirmChartConfig {
  startingBalance: number;
  profitTarget: number;
  maxDrawdown: number;
  dailyLossLimit: number;
  currentBalance: number;
  currentEquity: number;
  floatingPnL: number;
  hasLiveTrade: boolean;
}

export type ChartDisplayMode = 'trades' | 'daily';

interface AuraPalette {
  text: string;
  textMuted: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipTitle: string;
  tooltipBody: string;
  tooltipMuted: string;
}

const LIGHT: AuraPalette = {
  text: '#334155',
  textMuted: '#94A3B8',
  grid: 'rgba(148, 163, 184, 0.22)',
  axis: '#94A3B8',
  tooltipBg: 'rgba(255, 255, 255, 0.92)',
  tooltipBorder: 'rgba(124, 58, 237, 0.18)',
  tooltipTitle: '#1E293B',
  tooltipBody: '#475569',
  tooltipMuted: '#94A3B8',
};

const DARK: AuraPalette = {
  text: '#e2e8f0',
  textMuted: '#a8b5c7',
  grid: 'rgba(167, 139, 250, 0.16)',
  axis: '#a8b5c7',
  tooltipBg: 'rgba(15, 23, 42, 0.92)',
  tooltipBorder: 'rgba(139, 92, 246, 0.35)',
  tooltipTitle: '#EDE9FE',
  tooltipBody: '#cbd5e1',
  tooltipMuted: '#a8b5c7',
};

@Component({
  selector: 'app-prop-firm-equity-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './prop-firm-equity-chart.component.html',
  styleUrls: ['./prop-firm-equity-chart.component.scss'],
})
export class PropFirmEquityChartComponent implements OnInit, OnChanges, OnDestroy {
  /** Normalized equity/balance points — always reassigned (new reference) by the data layer. */
  @Input() points: AccountEquityPoint[] = [];
  /** Reference levels + current status. */
  @Input() config: PropFirmChartConfig = {
    startingBalance: 0,
    profitTarget: 0,
    maxDrawdown: 0,
    dailyLossLimit: 0,
    currentBalance: 0,
    currentEquity: 0,
    floatingPnL: 0,
    hasLiveTrade: false,
  };
  @Input() mode: ChartDisplayMode = 'trades';

  @ViewChild('chartEl', { static: true }) chartEl!: ElementRef<HTMLDivElement>;

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  hasNoTrades = true;
  isLive = false;

  constructor(@Inject(DOCUMENT) private document: Document) {}

  ngOnInit(): void {
    this.initChart();
    this.setupResize();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    if (this.chart) {
      this.render();
    }
  }

  /** Public hook called by the dashboard when the theme changes. */
  refresh(): void {
    if (this.chart) {
      this.render();
    }
  }

  get hasTrades(): boolean {
    return !this.hasNoTrades;
  }

  private isDark(): boolean {
    return this.document.body.classList.contains('dark-theme');
  }

  private palette(): AuraPalette {
    return this.isDark() ? DARK : LIGHT;
  }

  private initChart(): void {
    if (!this.chartEl?.nativeElement) return;
    this.chart = echarts.init(this.chartEl.nativeElement, undefined, { renderer: 'canvas' });
    this.render();
  }

  private setupResize(): void {
    if (!this.chartEl?.nativeElement || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      this.chart?.resize();
    });
    this.resizeObserver.observe(this.chartEl.nativeElement);
  }

  private fmtUsd(v: number): string {
    const sign = v >= 0 ? '+' : '-';
    return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private fmtUsdPlain(v: number): string {
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private updateChartState(): void {
    this.isLive = this.config.hasLiveTrade;
    this.hasNoTrades = (this.points || []).length <= 1 && !this.isLive;
  }

  /** Calendar-day key (YYYY-MM-DD) used to detect first trade of a day. */
  private dayKeyOfDay(ts: string): string {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '?';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  /** Short axis label for a trading day, e.g. "Aug 5". */
  private fmtAxisLabel(ts: string): string {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private fmtHeader(ts: string): string {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return 'START';
    const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const day = d.getDate();
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${mon} ${day} · ${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  /** Automatic, data-driven Y range that never compresses the curve. */
  private computeYRange(): { min: number; max: number } {
    const { startingBalance, profitTarget, maxDrawdown, dailyLossLimit } = this.config;
    const values: number[] = [];
    (this.points || []).forEach((p) => {
      if (p && Number.isFinite(p.equity)) values.push(p.equity);
      if (p && Number.isFinite(p.balance)) values.push(p.balance);
    });
    if (Number.isFinite(startingBalance)) values.push(startingBalance);
    if (Number.isFinite(profitTarget)) values.push(profitTarget);
    if (Number.isFinite(maxDrawdown)) values.push(maxDrawdown);
    if (Number.isFinite(dailyLossLimit)) values.push(dailyLossLimit);

    if (!values.length) return { min: 0, max: startingBalance || 1 };
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);

    // Sensible padding scaled to the account and the spread.
    const span = rawMax - rawMin;
    const basePad = (startingBalance || 1) * 0.02;
    const pad = Math.max(basePad, span * 0.18);
    let min = rawMin - pad;
    let max = rawMax + pad;

    // Guarantee a non-degenerate range for flat curves.
    if (max - min < basePad * 2) {
      min = rawMin - basePad;
      max = rawMax + basePad;
    }
    return { min, max };
  }

  private buildMarkLines(pal: AuraPalette): any[] {
    const { profitTarget, startingBalance, maxDrawdown, dailyLossLimit } = this.config;
    const lines: any[] = [];
    const labelBackground = this.isDark() ? 'rgba(15,23,42,0.78)' : 'rgba(255,255,255,0.84)';
    const labelStyle = {
      show: true,
      position: 'end',
      align: 'left',
      verticalAlign: 'middle',
      distance: 12,
      fontSize: 11,
      fontWeight: 700,
      backgroundColor: labelBackground,
      padding: [4, 8],
      borderRadius: 4,
    };

    if (Number.isFinite(profitTarget) && profitTarget > 0) {
      lines.push({
        yAxis: profitTarget,
        name: 'Profit Target',
        lineStyle: { color: '#16A34A', width: 1, type: 'dashed', opacity: 0.85 },
        label: {
          ...labelStyle,
          formatter: 'Profit Target',
          color: '#16A34A',
        },
      });
    }

    if (Number.isFinite(startingBalance) && startingBalance >= 0) {
      lines.push({
        yAxis: startingBalance,
        name: 'Starting Balance',
        lineStyle: { color: pal.textMuted, width: 1, type: 'dashed', opacity: 0.7 },
        label: {
          ...labelStyle,
          formatter: 'Start',
          color: pal.textMuted,
        },
      });
    }

    if (Number.isFinite(maxDrawdown) && maxDrawdown > 0) {
      lines.push({
        yAxis: maxDrawdown,
        name: 'Max Drawdown',
        lineStyle: { color: '#EF4444', width: 1, type: 'dashed', opacity: 0.8 },
        label: {
          ...labelStyle,
          formatter: 'Drawdown',
          color: '#EF4444',
        },
      });
    }

    if (Number.isFinite(dailyLossLimit) && dailyLossLimit > 0 && dailyLossLimit !== startingBalance) {
      lines.push({
        yAxis: dailyLossLimit,
        name: 'Daily Limit',
        lineStyle: { color: '#F59E0B', width: 1, type: 'dashed', opacity: 0.75 },
        label: {
          ...labelStyle,
          formatter: 'Daily Limit',
          color: '#F59E0B',
        },
      });
    }
    return lines;
  }

  private compactTime(ts: string): string {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const mon = d.toLocaleDateString('en-US', { month: 'short' });
    const day = d.getDate();
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${mon} ${day}, ${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  private esc(v: unknown): string {
    return String(v ?? '').replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
    );
  }

  private tradeDetailHtml(p: AccountEquityPoint, pal: AuraPalette): string {
    if (!p?.tradeId) return '';
    const rows: string[] = [];
    if (p.symbol) {
      const side = p.type ? p.type.toUpperCase() : '';
      let line = this.esc(p.symbol);
      if (side) line += ` &nbsp;·&nbsp; <b>${side}</b>`;
      if (p.volume) line += ` &nbsp;·&nbsp; ${this.esc(p.volume)} lots`;
      rows.push(`<div class="pf-td-line">${line}</div>`);
    }
    if (Number.isFinite(p.pnl)) {
      const color = (p.pnl || 0) >= 0 ? '#16A34A' : '#EF4444';
      rows.push(`<div class="pf-td-row"><span>P&amp;L</span><b style="color:${color}">${this.fmtUsd(p.pnl || 0)}</b></div>`);
    }
    if (Number.isFinite(p.risk) && p.risk && p.risk > 0) {
      rows.push(`<div class="pf-td-row"><span>Risk</span><b>${this.fmtUsdPlain(p.risk)}</b></div>`);
    }
    if (p.rr && p.rr !== '0' && p.rr !== '-') {
      rows.push(`<div class="pf-td-row"><span>R:R</span><b>${this.esc(p.rr)}</b></div>`);
    }
    const openLabel = p.openTime ? this.compactTime(p.openTime) : '';
    const closeLabel = p.closeTime ? this.compactTime(p.closeTime) : null;
    if (openLabel) {
      const suffix = closeLabel ? ` → ${closeLabel}` : '';
      rows.push(`<div class="pf-td-row"><span>Open</span><b>${openLabel}${suffix}</b></div>`);
    } else if (closeLabel) {
      rows.push(`<div class="pf-td-row"><span>Close</span><b>${closeLabel}</b></div>`);
    }

    return `
      <div class="pf-td-divider"></div>
      <div class="pf-td-title">Trade #${this.esc(p.tradeId)}</div>
      ${rows.join('')}
    `;
  }

  private tooltipHtml(params: any): string {
    const pal = this.palette();
    const first = params && params[0];
    const raw = first?.data as any;
    if (!raw) return '';

    const ts = raw.ts || raw.timestamp;
    const equity = Number(raw.equity ?? raw.value?.[1]);
    const balance = Number(raw.balance ?? equity);
    const floating = Number(raw.floatingPnL ?? 0);
    const isOpen = raw.tradeResult === 'open';
    const isCurrent = raw.isCurrent === true;

    const fpColor = floating >= 0 ? '#16A34A' : '#EF4444';

    let dailyRow = '';
    if (Number.isFinite(raw.dailyPnl)) {
      const c = (raw.dailyPnl || 0) >= 0 ? '#16A34A' : '#EF4444';
      dailyRow = `
        <div class="pf-td-row"><span>Daily P&amp;L</span><b style="color:${c}">${this.fmtUsd(raw.dailyPnl)}</b></div>`;
    }

    const liveTag = isOpen && isCurrent
      ? `<span class="pf-live-tag"><span class="pf-live-dot"></span>LIVE</span>`
      : '';

    return `
      <div class="pf-tooltip" style="min-width:${isOpen || raw.tradeId ? 232 : 200}px">
        <div class="pf-td-head" style="color:${pal.tooltipBody}">
          <span>${this.fmtHeader(ts || '')}</span>${liveTag}
        </div>
        <div class="pf-eq" style="color:${pal.tooltipTitle}">${this.fmtUsdPlain(equity)}</div>
        <div class="pf-eq-label" style="color:${pal.tooltipMuted}">Equity</div>
        <div class="pf-td-divider" style="margin:8px 0"></div>
        <div class="pf-td-row"><span style="color:${pal.tooltipMuted}">Balance</span><b style="color:${pal.tooltipBody}">${this.fmtUsdPlain(balance)}</b></div>
        <div class="pf-td-row"><span style="color:${pal.tooltipMuted}">Floating P&amp;L</span><b style="color:${fpColor}">${this.fmtUsd(floating)}</b></div>
        ${dailyRow}
        ${raw.tradeId ? this.tradeDetailHtml(raw as AccountEquityPoint, pal) : ''}
      </div>
    `;
  }

  private render(): void {
    if (!this.chart) return;
    this.updateChartState();

    const pal = this.palette();
    const yRange = this.computeYRange();

    // X positions are sequential event (category) indexes — no calendar-time gaps.
    const categories: string[] = [];
    let lastDayKey: string | null = null;
    const lineData: any[] = [];
    const winData: any[] = [];
    const lossData: any[] = [];
    const openData: any[] = [];

    (this.points || []).forEach((p, i) => {
      const x = i;
      const dayKey = this.dayKeyOfDay(p.timestamp);
      // Only emit a date label on the first data point of a trading day.
      if (i === 0 || dayKey !== lastDayKey) {
        categories.push(this.fmtAxisLabel(p.timestamp));
        lastDayKey = dayKey;
      } else {
        categories.push('');
      }
      const isLast = i === (this.points || []).length - 1;
      const item: any = {
        value: [x, p.equity],
        ts: p.timestamp,
        balance: p.balance,
        equity: p.equity,
        floatingPnL: p.floatingPnL ?? 0,
        tradeId: p.tradeId,
        tradeResult: p.tradeResult,
        symbol: p.symbol,
        type: p.type,
        volume: p.volume,
        risk: p.risk,
        rr: p.rr,
        openTime: p.openTime,
        closeTime: p.closeTime,
        pnl: p.pnl,
        dailyPnl: p.dailyPnl,
        isCurrent: isLast,
      };
      lineData.push(item);

      if (p.tradeResult === 'win') winData.push({ value: [x, p.equity], ts: p.timestamp, ...p, isCurrent: isLast });
      if (p.tradeResult === 'loss') lossData.push({ value: [x, p.equity], ts: p.timestamp, ...p, isCurrent: isLast });
      if (p.tradeResult === 'open') openData.push({ value: [x, p.equity], ts: p.timestamp, ...p, isCurrent: isLast });
    });

    const last = lineData.length ? lineData[lineData.length - 1] : null;
    const markLines = this.buildMarkLines(pal);

    const option: any = {
      animationDuration: 600,
      animationEasing: 'cubicOut',
      backgroundColor: 'transparent',
      grid: { left: 16, right: 156, top: 26, bottom: 34, containLabel: true },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: pal.tooltipBg,
        borderColor: pal.tooltipBorder,
        borderWidth: 1,
        padding: 12,
        extraCssText: 'backdrop-filter: blur(12px); border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,0.18);',
        textStyle: { color: pal.tooltipBody, fontSize: 12 },
        formatter: (params: any) => this.tooltipHtml(params),
      },
      xAxis: {
        type: 'category',
        data: categories,
        boundaryGap: false,
        axisLine: { lineStyle: { color: pal.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: pal.axis,
          fontSize: 11,
          hideOverlap: true,
          // Labels are pre-formatted: non-empty only on the first point of a
          // trading day; empty strings render no repeated date labels.
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: yRange.min,
        max: yRange.max,
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: pal.axis,
          fontSize: 11,
          formatter: (v: number) =>
            Math.abs(v) >= 10000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        },
        splitLine: { lineStyle: { color: pal.grid, type: 'dashed' } },
      },
      series: [
        {
          name: 'Equity',
          type: 'line',
          data: lineData,
          smooth: true,
          smoothMonotone: 'x',
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: {
            width: this.isDark() ? 3 : 2.5,
            color: '#7C3AED',
            shadowBlur: 14,
            shadowColor: 'rgba(124, 58, 237, 0.45)',
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: this.isDark() ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.28)' },
              { offset: 1, color: this.isDark() ? 'rgba(124,58,237,0.02)' : 'rgba(124,58,237,0.02)' },
            ]),
          },
          emphasis: { focus: 'series' },
          markLine: {
            symbol: 'none',
            silent: true,
            animation: false,
            data: markLines,
          },
        },
        // Trade markers — wins
        {
          name: 'Wins',
          type: 'scatter',
          data: winData,
          symbol: 'circle',
          symbolSize: 7,
          itemStyle: { color: '#16A34A', borderColor: this.isDark() ? '#0f172a' : '#ffffff', borderWidth: 1.5 },
          z: 5,
          tooltip: { show: false },
          emphasis: { scale: 1.6 },
        },
        // Trade markers — losses
        {
          name: 'Losses',
          type: 'scatter',
          data: lossData,
          symbol: 'circle',
          symbolSize: 7,
          itemStyle: { color: '#EF4444', borderColor: this.isDark() ? '#0f172a' : '#ffffff', borderWidth: 1.5 },
          z: 5,
          tooltip: { show: false },
          emphasis: { scale: 1.6 },
        },
        // Trade markers — open/live trades
        {
          name: 'Open',
          type: 'scatter',
          data: openData,
          symbol: 'circle',
          symbolSize: 8,
          itemStyle: { color: '#8B5CF6', borderColor: '#0f172a', borderWidth: 1.5, shadowBlur: 10, shadowColor: 'rgba(139,92,246,0.6)' },
          z: 6,
          tooltip: { show: false },
          emphasis: { scale: 1.6 },
        },
      ],
      graphic: [],
    };

    // Current point: larger marker + subtle glow.
    if (last && this.points.length > 1) {
      option.series.push({
        name: 'Current',
        type: 'scatter',
        data: [
          {
            value: [last.value[0], last.value[1]],
            itemStyle: {
              color: this.pointCurrentColor(),
              shadowBlur: 16,
              shadowColor: 'rgba(124,58,237,0.65)',
            },
          },
        ],
        symbol: 'circle',
        symbolSize: 13,
        z: 7,
        itemStyle: { borderColor: this.isDark() ? '#0f172a' : '#ffffff', borderWidth: 2 },
        tooltip: { show: false },
      });
    }

    // Subtle live pulse via effectScatter when there is an open trade.
    if (this.config.hasLiveTrade && last) {
      option.series.push({
        name: 'LivePulse',
        type: 'effectScatter',
        data: [[last.value[0], last.value[1]]],
        symbol: 'circle',
        symbolSize: 22,
        rippleEffect: { brushType: 'stroke', scale: 2.8, period: 4 },
        itemStyle: { color: '#8B5CF6' },
        z: 4,
        silent: true,
        tooltip: { show: false },
      });
    }

    this.chart.setOption(option, { notMerge: true });
  }

  private pointCurrentColor(): string {
    if (this.config.hasLiveTrade) return '#8B5CF6';
    return this.config.currentEquity >= this.config.startingBalance ? '#16A34A' : '#EF4444';
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.chart) {
      this.chart.dispose();
      this.chart = null;
    }
  }
}
