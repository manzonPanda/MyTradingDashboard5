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
    const gaugeHeight = this.gaugeElement.nativeElement.clientHeight;
    if (!gaugeWidth || !gaugeHeight) return;

    const gaugeRadius = Math.min(gaugeWidth * 0.48, gaugeHeight * 0.78);
    const gaugeCenterX = gaugeWidth / 2;
    const gaugeCenterY = gaugeHeight * 0.9;
    const scale = Math.max(0.72, Math.min(1.2, gaugeWidth / 600));
    const axisLineWidth = Math.max(10, Math.round(16 * scale));
    const pointerWidth = Math.max(24, Math.round(40 * scale));
    const axisTickWidth = Math.max(1, Math.round(2 * scale));
    const splitLineWidth = Math.max(2, Math.round(5 * scale));
    const axisTickLength = Math.max(6, Math.round(10 * scale));
    const splitLineLength = Math.max(9, Math.round(14 * scale));
    const axisLabelFontSize = Math.max(9, Math.round(20 * scale));
    const titleFontSize = Math.max(10, Math.round(22 * scale));
    const detailFontSize = Math.max(18, Math.round(30 * scale));

    this.chart.setOption({
      animationDuration: 600,
      animationEasing: 'cubicOut',
      series: [{
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        center: [gaugeCenterX, gaugeCenterY],
        radius: gaugeRadius,
        min: 0,
        max: 3.5,
        splitNumber: 7,
        axisLine: {
          lineStyle: {
            width: axisLineWidth,
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
          length: '17%',
          width: pointerWidth,
          offsetCenter: [0, '-68%'],
          itemStyle: { color: 'auto' },
        },
        axisTick: {
          distance: 0,
          splitNumber: 4,
          length: axisTickLength,
          lineStyle: { color: 'auto', width: axisTickWidth },
        },
        splitLine: {
          distance: 0,
          length: splitLineLength,
          lineStyle: { color: 'auto', width: splitLineWidth },
        },
        axisLabel: {
          color: '#64748B',
          fontSize: axisLabelFontSize,
          distance: 18,
          formatter: (value: number) => {
            if (value === 0) return '0.0';
            if (value === 1) return '1.0';
            if (value === 3) return '3.0';
            if (value === 3.5) return '3.5+';
            return '';
          },
        },
        title: {
          offsetCenter: [0, '-7%'],
          fontSize: titleFontSize,
          lineHeight: Math.round(24 * scale),
          fontWeight: 600,
          color: 'auto',
        },
        detail: {
          fontSize: detailFontSize,
          lineHeight: Math.round(36 * scale),
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
