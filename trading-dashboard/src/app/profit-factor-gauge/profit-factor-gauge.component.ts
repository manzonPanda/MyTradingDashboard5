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

    const displayedValue = Math.max(0, Math.min(3.5, this.value));
    const status = this.getStatus(displayedValue);
    const gaugeWidth = this.gaugeElement.nativeElement.clientWidth;
    const scale = Math.max(0.82, Math.min(1.15, gaugeWidth / 230));
    const pointerWidth = Math.round(40 * scale);
    const axisLabelFontSize = Math.max(8, Math.round(10 * scale));
    const titleFontSize = Math.max(9, Math.round(11 * scale));
    const detailFontSize = Math.max(18, Math.round(24 * scale));

    this.chart.setOption({
      animationDuration: 600,
      animationEasing: 'cubicOut',
      series: [{
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        center: ['50%', '72%'],
        radius: '90%',
        min: 0,
        max: 3.5,
        splitNumber: 7,
        axisLine: {
          lineStyle: {
            width: 20,
            color: [
              [1 / 3.5, '#EF4444'],
              [1.3 / 3.5, '#F59E0B'],
              [1.75 / 3.5, '#EAB308'],
              [3 / 3.5, '#22C55E'],
              [1, '#8B5CF6'],
            ],
          },
        },
        pointer: {
          icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
          length: '15%',
          width: pointerWidth,
          offsetCenter: [0, '-70%'],
          itemStyle: { color: 'auto' },
        },
        axisTick: {
          distance: -20,
          splitNumber: 4,
          length: 8,
          lineStyle: { color: 'auto', width: 2 },
        },
        splitLine: {
          distance: -22,
          length: 12,
          lineStyle: { color: 'auto', width: 4 },
        },
        axisLabel: {
          color: '#64748B',
          fontSize: axisLabelFontSize,
          distance: 12,
          formatter: (value: number) => {
            if (value === 0) return '0.0';
            if (value === 1) return '1.0';
            if (value === 3) return '3.0';
            if (value === 3.5) return '3.5+';
            return '';
          },
        },
        title: {
          offsetCenter: [0, '-2%'],
          fontSize: titleFontSize,
          lineHeight: Math.round(14 * scale),
          fontWeight: 600,
          color: 'auto',
        },
        detail: {
          fontSize: detailFontSize,
          lineHeight: Math.round(28 * scale),
          fontWeight: 700,
          offsetCenter: [0, '-30%'],
          valueAnimation: true,
          formatter: (value: number) => value.toFixed(2),
          color: 'auto',
        },
        data: [{ value: displayedValue, name: status }],
        silent: true,
      }],
    }, { notMerge: true });
  }

  private getStatus(value: number): string {
    if (value < 1) return 'UNPROFITABLE';
    if (value < 1.3) return 'MARGINAL';
    if (value < 1.75) return 'RESPECTABLE';
    if (value < 3) return 'STRONG';
    return 'EXCEPTIONAL';
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }
}
