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
  @Input() gradeRating = 0;
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

    const actualProfitFactor = Number.isFinite(this.profitFactor) ? this.profitFactor : 0;
    const gradeValue = Math.max(0, Math.min(Number.isFinite(this.gradeRating) ? this.gradeRating : 0, 1));
    const isDark = this.document.body.classList.contains('dark-theme');
    const tooltipTextColor = isDark ? '#e2e8f0' : '#1e293b';
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
        textStyle: { color: tooltipTextColor, fontSize: 12 },
        formatter: () => {
          const lines = [
            '<strong>Grade Rating</strong>',
            `${Math.round(gradeValue * 100)}%`,
            `Profit Factor: ${actualProfitFactor.toFixed(2)}`,
          ];
          if (this.grossProfit > 0 || this.grossLoss > 0) {
            lines.push(
              `Gross Profit: $${this.grossProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              `Gross Loss: $${this.grossLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            );
          }
          return lines.join('<br/>');
        },
      },
      series: [
        {
          type: 'gauge',
          startAngle: 180,
          endAngle: 0,
          center: ['50%', '75%'],
          radius: '90%',
          min: 0,
          max: 1,
          splitNumber: 8,
          axisLine: {
            lineStyle: {
              width: 6,
              color: [
                [0.25, '#FF6E76'],
                [0.5, '#FDDD60'],
                [0.75, '#58D9F9'],
                [1, '#7CFFB2'],
              ],
            },
          },
          pointer: {
            show: true,
            icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
            length: '12%',
            width: 20,
            offsetCenter: [0, '-60%'],
            itemStyle: { color: 'auto' },
          },
          axisTick: {
            length: 12,
            lineStyle: {
              color: 'auto',
              width: 2,
            },
          },
          splitLine: {
            length: 20,
            lineStyle: {
              color: 'auto',
              width: 5,
            },
          },
          axisLabel: {
            color: isDark ? '#cbd5e1' : '#464646',
            fontSize: 20,
            distance: -60,
            rotate: 'tangential',
            formatter: (value: number) => {
              if (value === 0.875) return 'Grade A';
              if (value === 0.625) return 'Grade B';
              if (value === 0.375) return 'Grade C';
              if (value === 0.125) return 'Grade D';
              return '';
            },
          },
          title: {
            offsetCenter: [0, '-10%'],
            fontSize: 20,
          },
          detail: {
            fontSize: 30,
            offsetCenter: [0, '-35%'],
            valueAnimation: true,
            formatter: (value: number) => `${Math.round(value * 100)}%`,
            color: 'inherit',
          },
          data: [
            {
              value: gradeValue,
              name: 'Grade Rating',
            },
          ],
        },
      ],
    }, { notMerge: true });
  }
}
