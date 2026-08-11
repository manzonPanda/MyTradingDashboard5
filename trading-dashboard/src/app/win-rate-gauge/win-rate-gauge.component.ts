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

export interface WinRateGaugeStats {
  wins: number;
  losses: number;
  winRate: number;
}

@Component({
  selector: 'app-win-rate-gauge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './win-rate-gauge.component.html',
  styleUrls: ['./win-rate-gauge.component.scss'],
})
export class WinRateGaugeComponent implements OnInit, OnChanges, OnDestroy {
  @Input() stats: WinRateGaugeStats = { wins: 0, losses: 0, winRate: 0 };

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

    const isDark = this.document.body.classList.contains('dark-theme');
    const winRate = Math.max(0, Math.min(100, this.stats.winRate));
    const trackColor = isDark ? 'rgba(148, 163, 184, 0.28)' : '#e5e7eb';
    const gaugeWidth = this.gaugeElement.nativeElement.clientWidth;
    const gaugeHeight = this.gaugeElement.nativeElement.clientHeight;
    if (!gaugeWidth || !gaugeHeight) return;

    const gaugeRadius = Math.min(gaugeWidth * 0.46, gaugeHeight * 0.78);
    const gaugeCenter = [gaugeWidth / 2, gaugeHeight * 0.78];
    const scale = Math.max(0.82, Math.min(1.15, gaugeWidth / 230));
    const trackWidth = Math.max(10, Math.round(16 * scale));
    const progressWidth = Math.max(7, Math.round(10 * scale));

    this.chart.setOption({
      animationDuration: 600,
      animationEasing: 'cubicOut',
      series: [
        {
          type: 'gauge',
          startAngle: 180,
          endAngle: 0,
          min: 0,
          max: 100,
          center: gaugeCenter,
          radius: gaugeRadius,
          pointer: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          anchor: { show: false },
          detail: { show: false },
          title: { show: false },
          progress: { show: false },
          axisLine: {
            roundCap: true,
            lineStyle: { width: trackWidth, color: [[1, trackColor]] },
          },
          silent: true,
        },
        {
          type: 'gauge',
          startAngle: 180,
          endAngle: 0,
          min: 0,
          max: 100,
          center: gaugeCenter,
          radius: gaugeRadius,
          pointer: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          anchor: { show: false },
          detail: { show: false },
          title: { show: false },
          progress: { show: false },
          axisLine: {
            roundCap: true,
            lineStyle: {
              width: progressWidth,
              color: [
                [winRate / 100, '#16a34a'],
                [1, '#ef4444'],
              ],
            },
          },
          silent: true,
        },
      ],
    }, { notMerge: true });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }
}
