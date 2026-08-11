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

@Component({
  selector: 'app-profit-factor-gauge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profit-factor-gauge.component.html',
  styleUrls: ['./profit-factor-gauge.component.scss'],
})
export class ProfitFactorGaugeComponent implements OnInit, OnChanges, OnDestroy {
  @Input() profitFactor = 0;
  @Input() grossProfit = 0;
  @Input() grossLoss = 0;

  @ViewChild('gaugeElement', { static: true }) gaugeElement!: ElementRef<HTMLDivElement>;

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(@Inject(DOCUMENT) private document: Document) {}

  ngOnInit(): void {
    this.chart = echarts.init(this.gaugeElement.nativeElement, undefined, {
      renderer: 'canvas',
      useDirtyRect: false,
    });
    this.render();
    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(this.gaugeElement.nativeElement);
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.render();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }

  private render(): void {
    if (!this.chart) return;

    const actualValue = Number.isFinite(this.profitFactor) ? this.profitFactor : 0;
    const gaugeValue = Math.max(0, Math.min(actualValue, 3));
    const statusColor = this.getStatusColor(actualValue);
    const isDark = this.document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#e2e8f0' : '#1e293b';
    const mutedColor = isDark ? '#a8b5c7' : '#64748b';
    const tickColor = isDark ? 'rgba(203, 213, 225, 0.7)' : 'rgba(71, 85, 105, 0.7)';
    const tooltipBackground = isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.96)';
    const tooltipBorder = isDark ? 'rgba(139, 92, 246, 0.35)' : 'rgba(124, 58, 237, 0.18)';

    this.chart.setOption({
      animationDuration: 500,
      animationEasing: 'cubicOut',
      tooltip: {
        trigger: 'item',
        backgroundColor: tooltipBackground,
        borderColor: tooltipBorder,
        borderWidth: 1,
        textStyle: { color: textColor, fontSize: 12 },
        formatter: () => {
          const lines = [`<strong>Profit Factor</strong>`, actualValue.toFixed(2)];
          if (this.grossProfit > 0 || this.grossLoss > 0) {
            lines.push(
              `Gross Profit: $${this.grossProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              `Gross Loss: $${this.grossLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            );
          }
          return lines.join('<br/>');
        },
      },
      graphic: [
        {
          type: 'text',
          left: '8%',
          top: '88%',
          silent: true,
          style: {
            text: 'LOSING',
            fill: '#EF4444',
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: 0.5,
          },
        },
        {
          type: 'text',
          left: 'center',
          top: '88%',
          silent: true,
          style: {
            text: 'PROFITABLE',
            fill: '#F59E0B',
            fontSize: 8,
            fontWeight: 700,
            textAlign: 'center',
            letterSpacing: 0.5,
          },
        },
        {
          type: 'text',
          right: '8%',
          top: '88%',
          silent: true,
          style: {
            text: 'STRONG',
            fill: '#22C55E',
            fontSize: 8,
            fontWeight: 700,
            textAlign: 'right',
            letterSpacing: 0.5,
          },
        },
      ],
      series: [
        {
          type: 'gauge',
          startAngle: 180,
          endAngle: 0,
          center: ['50%', '78%'],
          radius: '78%',
          min: 0,
          max: 3,
          splitNumber: 3,
          pointer: {
            show: true,
            icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
            length: '18%',
            width: 10,
            offsetCenter: [0, '-42%'],
            itemStyle: {
              color: statusColor,
              shadowBlur: 2,
              shadowColor: 'rgba(15, 23, 42, 0.2)',
            },
          },
          axisLine: {
            roundCap: true,
            lineStyle: {
              width: 8,
              color: [
                [1 / 3, '#EF4444'],
                [2 / 3, '#F59E0B'],
                [1, '#22C55E'],
              ],
            },
          },
          axisTick: {
            show: true,
            splitNumber: 1,
            length: 4,
            lineStyle: { color: tickColor, width: 1 },
          },
          splitLine: {
            show: true,
            length: 10,
            distance: 0,
            lineStyle: { color: tickColor, width: 2.5 },
          },
          axisLabel: {
            show: true,
            distance: 10,
            color: mutedColor,
            fontSize: 8,
            fontWeight: 600,
            formatter: (value: number) => {
              if (value < 0 || value > 3 || value % 1 !== 0) return '';
              return value === 3 ? '3.0+' : value.toFixed(1);
            },
          },
          anchor: {
            show: false,
          },
          detail: {
            show: false,
          },
          title: {
            show: false,
          },
          data: [{ value: gaugeValue }],
        },
      ],
    }, { notMerge: true });
  }

  private getStatusColor(value: number): string {
    if (value >= 2) return '#166534';
    if (value > 1) return '#15803D';
    if (value === 1) return '#64748B';
    return '#B91C1C';
  }
}
