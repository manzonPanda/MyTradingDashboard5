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
import { DOCUMENT } from '@angular/common';
import * as echarts from 'echarts';

@Component({
  selector: 'app-live-trade-gauge',
  standalone: true,
  templateUrl: './live-trade-gauge.component.html',
  styleUrls: ['./live-trade-gauge.component.scss'],
})
export class LiveTradeGaugeComponent implements OnInit, OnChanges, OnDestroy {
  /**
   * Signed unrealized P&L expressed as a percentage of the account size.
   * A negative value renders the ring in red with a leading minus sign.
   */
  @Input() value = 0;

  /** % of account at which a POSITIVE P&L fills the whole ring (clockwise). */
  @Input() positiveMax = 3;

  /** % of account at which a NEGATIVE P&L fills the whole ring (counter-clockwise, risk consumed). */
  @Input() negativeMax = 1;

  /** Instrument symbol, used only for the accessible label. */
  @Input() symbol = '';

  @ViewChild('gaugeElement', { static: true }) gaugeElement!: ElementRef<HTMLDivElement>;

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(@Inject(DOCUMENT) private document: Document) {}

  get ariaLabel(): string {
    const prefix = this.symbol ? `${this.symbol} ` : '';
    return `${prefix}unrealized P&L gauge`;
  }

  ngOnInit(): void {
    this.chart = echarts.init(this.gaugeElement.nativeElement, undefined, { renderer: 'canvas' });
    this.render();
    this.resizeObserver = new ResizeObserver(() => {
      this.chart?.resize();
      this.render();
    });
    this.resizeObserver.observe(this.gaugeElement.nativeElement);
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.render();
  }

  private render(): void {
    if (!this.chart) return;

    const width = this.gaugeElement.nativeElement.clientWidth;
    const height = this.gaugeElement.nativeElement.clientHeight;
    if (!width || !height) return;

    const safePositiveMax = Math.max(0.1, this.positiveMax);
    const safeNegativeMax = Math.max(0.1, this.negativeMax);

    const raw = Number.isFinite(this.value) ? this.value : 0;
    const clamped = Math.max(-safeNegativeMax, Math.min(safePositiveMax, raw));

    const isNegative = clamped < 0;
    const magnitude = Math.abs(clamped);

    let color: string;
    let glow: { shadowBlur: number; shadowColor: string };
    let posValue = 0;
    let negValue = 0;

    if (isNegative) {
      // Risk-consumed scale: a full ring = the account risk %.
      const normalized = Math.max(0, Math.min(1, magnitude / safeNegativeMax));
      color = '#ef4444';
      glow = this.getGlow(normalized, color);
      negValue = magnitude;
    } else {
      // Fixed 3% scale: a full ring = 3% P&L.
      const normalized = Math.max(0, Math.min(1, clamped / safePositiveMax));
      color = this.getRadiantColor(normalized);
      glow = this.getGlow(normalized, color);
      posValue = clamped;
    }

    const size = Math.min(width, height) || 1;
    const scale = Math.max(0.55, Math.min(1.2, size / 140));
    const ringWidth = Math.max(7, Math.round(16 * scale));
    const fontSize = Math.max(14, Math.round(19 * scale));

    const baseGauge = {
      type: 'gauge' as const,
      center: ['50%', '50%'],
      radius: '72%',
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      title: { show: false },
      detail: { show: false },
      anchor: { show: false },
      silent: true,
    };

    this.chart.setOption(
      {
        // Live P&L updates arrive frequently, so keep update animations short
        // to avoid the gauge lagging behind the real value.
        animationDuration: 250,
        animationDurationUpdate: 120,
        animationEasing: 'cubicOut',
        animationEasingUpdate: 'cubicOut',
        series: [
          // ------------------------------------------------------------------
          // 1) Background track + signed centre value.
          //    Symmetric-ish range so the signed detail value stays in range.
          // ------------------------------------------------------------------
          {
            ...baseGauge,
            startAngle: 90,
            endAngle: -270,
            min: -safeNegativeMax,
            max: safePositiveMax,
            progress: { show: false },
            axisLine: {
              lineStyle: {
                width: ringWidth,
                color: [[1, '#e5e7eb']],
              },
            },
            data: [{ value: clamped, name: '' }],
            detail: {
              offsetCenter: ['0%', '0%'],
              fontSize,
              fontWeight: 'bold',
              color,
              valueAnimation: true,
              formatter: (v: number) => `${v.toFixed(2)}%`,
            },
          },
          // ------------------------------------------------------------------
          // 2) Positive progress - CLOCKWISE, full ring at positiveMax (3%).
          // ------------------------------------------------------------------
          {
            ...baseGauge,
            startAngle: 90,
            endAngle: -270,
            min: 0,
            max: safePositiveMax,
            axisLine: { show: false },
            progress: {
              show: true,
              overlap: false,
              roundCap: false,
              clip: false,
              itemStyle: {
                color,
                shadowBlur: isNegative ? 0 : glow.shadowBlur,
                shadowColor: isNegative ? 'transparent' : glow.shadowColor,
              },
            },
            data: [{ value: posValue, name: '' }],
          },
          // ------------------------------------------------------------------
          // 3) Negative progress - COUNTER-CLOCKWISE (red), full ring at the
          //    account risk %. clockwise:false reverses the sweep direction.
          // ------------------------------------------------------------------
          {
            ...baseGauge,
            startAngle: 90,
            endAngle: -270,
            clockwise: false,
            min: 0,
            max: safeNegativeMax,
            axisLine: { show: false },
            progress: {
              show: true,
              overlap: false,
              roundCap: false,
              clip: false,
              itemStyle: {
                color: '#ef4444',
                shadowBlur: isNegative ? glow.shadowBlur : 0,
                shadowColor: isNegative ? glow.shadowColor : 'transparent',
              },
            },
            data: [{ value: negValue, name: '' }],
          },
        ],
      },
      // Merge (not full replace) so high-frequency P&L updates animate
      // smoothly from the previous value instead of re-initialising each tick.
      { notMerge: false }
    );
  }

  /**
   * Radiant ramp: light green -> cyan -> "Super Saiyan blue".
   * `t` is in [0, 1] where 1 is the full positive fill.
   */
  private getRadiantColor(t: number): string {
    if (t < 0.5) {
      const p = t / 0.5;
      const r = Math.round(134 + (34 - 134) * p);
      const g = Math.round(239 + (211 - 239) * p);
      const b = Math.round(172 + (238 - 172) * p);
      return `rgb(${r}, ${g}, ${b})`;
    }

    const p = (t - 0.5) / 0.5;
    const r = Math.round(34 + (0 - 34) * p);
    const g = Math.round(211 + (191 - 211) * p);
    const b = Math.round(238 + (255 - 238) * p);
    return `rgb(${r}, ${g}, ${b})`;
  }

  /** Soft glow that intensifies as the fill approaches its maximum. */
  private getGlow(t: number, color: string): { shadowBlur: number; shadowColor: string } {
    const intensity = t * t;
    return {
      shadowBlur: 5 + intensity * 60,
      shadowColor: color,
    };
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }
}
