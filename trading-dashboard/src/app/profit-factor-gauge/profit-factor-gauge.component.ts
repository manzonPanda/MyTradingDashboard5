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
  selector: 'app-profit-factor-gauge',
  standalone: true,
  templateUrl: './profit-factor-gauge.component.html',
  styleUrls: ['./profit-factor-gauge.component.scss'],
})
export class ProfitFactorGaugeComponent implements OnInit, OnChanges, OnDestroy {
  @Input() value = 0;

  @ViewChild('gaugeElement', { static: true }) gaugeElement!: ElementRef<HTMLDivElement>;

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(@Inject(DOCUMENT) private document: Document) {}

  ngOnInit(): void {
    this.chart = echarts.init(this.gaugeElement.nativeElement, undefined, { renderer: 'canvas' });
    this.render();
    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(this.gaugeElement.nativeElement);
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.render();
  }

  private render(): void {
    if (!this.chart) return;

    const isDark = this.document.body.classList.contains('dark-theme');
    const displayedValue = Math.max(0, Math.min(3, this.value));
    const labelColor = isDark ? '#cbd5e1' : '#475569';
    const pointerColor = isDark ? '#f8fafc' : '#0f172a';

    this.chart.setOption({
      animationDuration: 600,
      animationEasing: 'cubicOut',
      series: [{
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        center: ['50%', '75%'],
        radius: '100%',
        min: 0,
        max: 3,
        splitNumber: 3,
        axisLine: {
          lineStyle: {
            width: 14,
            color: [
              [1 / 3, '#EF4444'],
              [2 / 3, '#F59E0B'],
              [1, '#22C55E'],
            ],
          },
        },
        pointer: {
          icon: 'path://M2 0 L-2 0 L0 -66 Z',
          length: '62%',
          width: 8,
          offsetCenter: [0, '5%'],
          itemStyle: { color: pointerColor },
        },
        anchor: {
          show: true,
          size: 11,
          itemStyle: { color: pointerColor },
        },
        axisTick: {
          distance: -18,
          splitNumber: 4,
          length: 6,
          lineStyle: { color: isDark ? 'rgba(203, 213, 225, 0.55)' : 'rgba(71, 85, 105, 0.45)', width: 1 },
        },
        splitLine: {
          distance: -20,
          length: 12,
          lineStyle: { color: labelColor, width: 1.5 },
        },
        title: { show: false },
        detail: { show: false },
        data: [{ value: displayedValue }],
        silent: true,
      }],
    }, { notMerge: true });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }
}
