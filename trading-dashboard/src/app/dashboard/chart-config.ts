import { ChartConfiguration } from 'chart.js';

export interface FuturesChartData {
  labels: string[];
  balanceData: number[];
  profitTargetData: number[];
  maxLossData: number[];
  trailingDrawdownData: number[];
}

export function createFuturesChartConfig(data: FuturesChartData): ChartConfiguration {
  return {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: 'Account Balance',
          data: data.balanceData,
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: 'rgb(16, 185, 129)',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'Profit Target (6%)',
          data: data.profitTargetData,
          borderColor: 'rgb(34, 197, 94)',
          backgroundColor: 'rgba(34, 197, 94, 0.02)',
          borderWidth: 3,
          borderDash: [8, 4],
          fill: false,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: 'rgb(34, 197, 94)',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2
        },
        {
          label: 'Max Loss (5%)',
          data: data.maxLossData,
          borderColor: 'rgb(239, 68, 68)',
          backgroundColor: 'rgba(239, 68, 68, 0.02)',
          borderWidth: 3,
          borderDash: [4, 8],
          fill: false,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: 'rgb(239, 68, 68)',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2
        },
        {
          label: 'MFE Trailing (5%)',
          data: data.trailingDrawdownData,
          borderColor: 'rgb(249, 115, 22)',
          backgroundColor: 'rgba(249, 115, 22, 0.05)',
          borderWidth: 2,
          borderDash: [2, 2],
          fill: false,
          tension: 0.2,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointBackgroundColor: 'rgb(249, 115, 22)',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1000,
        easing: 'easeInOutQuart'
      },
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'start',
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            padding: 15,
            usePointStyle: true,
            font: {
              size: 12,
              weight: 'normal'
            },
            color: '#64748b'
          }
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          cornerRadius: 8,
          displayColors: true,
          padding: 12,
          titleFont: {
            size: 16,
            weight: 'bold'
          },
          bodyFont: {
            size: 14
          },
          callbacks: {
            title: function(context: any) {
              return context[0].label;
            },
            label: function(context: any) {
              const value = context.parsed.y;
              const label = context.dataset.label;

              // Custom tooltips for different line types
              if (label === 'Profit Target (6%)') {
                return `🎯 Profit Target: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              } else if (label === 'Max Loss (5%)') {
                return `🛑 Max Loss: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              } else if (label === 'MFE Trailing (5%)') {
                return `📉 MFE Trailing: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              } else if (label === 'Account Balance') {
                return `💰 Balance: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              }
              return `${label}: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.08)'
          },
          ticks: {
            font: {
              size: 14
            },
            color: '#64748b'
          }
        },
        y: {
          display: true,
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.08)'
          },
          ticks: {
            font: {
              size: 14
            },
            color: '#64748b',
            callback: function(value: any) {
              return '$' + value.toLocaleString();
            }
          },
          title: {
            display: true,
            text: 'Account Balance ($)',
            color: '#64748b',
            font: {
              size: 16,
              weight: 'bold'
            }
          }
        }
      }
    }
  };
}
