import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

interface Table {
  openDate: string;
  tradeNotion: any[];
  status: string;
  position: string;
  symbol: string;
  type: string;
  volume: string;
  entry: string;
  sL: string;
  tP: string;
  closeDate: string;
  exit: string;
  commission: string;
  swap: string;
  profit: string;
  netProfit: string;
}

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  trades: Table[];
  pnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  dailyPercentage: number;
  totalWinAmount: number;
  totalLossAmount: number;
}

interface WeekSummary {
  weekNumber: number;
  label: string;
  totalPnL: number;
  totalTrades: number;
  days: number;
  weeklyPercentageGained: number;
}

@Component({
  selector: 'app-trading-calendar',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    <div class="trading-calendar-container">
      <!-- Calendar Header -->
      <div class="calendar-header">
        <div class="calendar-nav">
          <button mat-button class="nav-button" (click)="previousMonth()">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <h2 class="month-title">{{ currentDate | date: 'MMMM yyyy' }}</h2>
          <button mat-button class="nav-button" (click)="nextMonth()">
            <mat-icon>chevron_right</mat-icon>
          </button>
        </div>
        <div class="monthly-stats">
          <span class="stats-label">Monthly stats:</span>
          <span class="stats-value" [ngClass]="getMonthlyPnLClass()">{{ formatCurrency(getMonthlyPnL()) }}</span>
          <span class="stats-days">{{ getActiveTradingDays() }} days</span>
        </div>
      </div>

      <div class="calendar-grid-container">
        <!-- Calendar Grid -->
        <div class="calendar-grid">
          <!-- Day Headers -->
          <div class="day-headers">
            <div class="day-header" *ngFor="let day of weekDays">{{ day }}</div>
          </div>

          <!-- Calendar Days -->
          <div class="calendar-days">
            <div 
              *ngFor="let day of calendarDays" 
              class="calendar-day"
              [ngClass]="{
                'outside-month': !day.isCurrentMonth,
                'today': day.isToday,
                'has-trades': day.tradeCount > 0,
                'profit-day': day.pnl > 0,
                'loss-day': day.pnl < 0,
                'weekday-profit': isWeekday(day.date) && day.pnl > 0,
                'weekday-loss': isWeekday(day.date) && day.pnl < 0,
                'weekend': !isWeekday(day.date)
              }">
              <div class="day-number">{{ day.date.getDate() }}</div>
              <div class="day-content" *ngIf="day.tradeCount > 0">
                <div class="day-net-pnl" [ngClass]="getDayPnLClass(day.pnl)">
                  
                  {{ formatPercentage(day.dailyPercentage) }}
                </div>
                <div class="day-trades-summary">
                  <div class="trades-count">
                    <span class="win-count">{{ day.winCount }}W</span>
                    <span class="separator">•</span>
                    <span class="loss-count">{{ day.lossCount }}L</span>
                  </div>
                  <div class="day-win-loss-amounts">
                    <div class="amounts-row">
                      <div class="win-amount" [ngClass]="{ 'zero-amount': day.totalWinAmount === 0 }">
                        <span class="amount-icon">↗</span>
                        <span class="amount-value">{{ formatCurrency(day.totalWinAmount || 0) }}</span>
                      </div>
                      <div class="loss-amount" [ngClass]="{ 'zero-amount': day.totalLossAmount === 0 }">
                        <span class="amount-icon">↘</span>
                        <span class="amount-value">{{ formatCurrency(getAbsoluteValue(day.totalLossAmount || 0)) }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="day-percentage" [ngClass]="getDayPnLClass(day.pnl)">
                   
                    {{ formatCurrency(day.pnl) }}
                  </div>
                </div>

              </div>

              <!-- Show zero amounts for current month days with no trades -->
              <div class="day-content-zero" *ngIf="day.tradeCount === 0 && day.isCurrentMonth && isWeekday(day.date)">
                <div class="day-win-loss-amounts">
                  <div class="amounts-row">
                    <div class="win-amount zero-amount">
                      <span class="amount-icon">↗</span>
                      <span class="amount-value">$0</span>
                    </div>
                    <div class="loss-amount zero-amount">
                      <span class="amount-icon">↘</span>
                      <span class="amount-value">$0</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Weekly Summary Sidebar -->
        <div class="weekly-summary">
          <div *ngFor="let week of weekSummaries" class="week-summary">
            <div class="week-label">{{ week.label }}</div>
            <div class="week-percentage" [ngClass]="getWeekPnLClass(week.totalPnL)">
              {{ formatPercentage(week.weeklyPercentageGained) }}
            </div>
            <div class="week-pnl" [ngClass]="getWeekPnLClass(week.totalPnL)">
              {{ formatCurrency(week.totalPnL) }}
            </div>
            <div class="week-details">{{ week.days }} days</div>
          </div>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./trading-calendar.component.scss']
})
export class TradingCalendarComponent implements OnInit, OnChanges {
  @Input() tableData: Table[] = [];
  @Input() viewDate: Date = new Date();

  currentDate: Date = new Date();
  calendarDays: CalendarDay[] = [];
  weekSummaries: WeekSummary[] = [];

  readonly PROP_FIRM_ACCOUNT_VALUE = 5000; // $5k prop firm account
  weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  ngOnInit() {
    this.currentDate = this.viewDate || new Date();
    this.generateCalendar();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['tableData'] || changes['viewDate']) {
      if (changes['viewDate'] && changes['viewDate'].currentValue) {
        this.currentDate = new Date(changes['viewDate'].currentValue);
      }
      this.generateCalendar();
    }
  }

  generateCalendar() {
    this.calendarDays = [];
    this.weekSummaries = [];

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    
    // Get first day of month and how many days to show from previous month
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const firstDayOfWeek = firstDayOfMonth.getDay();
    const daysInMonth = lastDayOfMonth.getDate();

    // Generate calendar days
    const totalDays = 42; // 6 weeks × 7 days
    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(startDate.getDate() - firstDayOfWeek);

    for (let i = 0; i < totalDays; i++) {
      const currentDay = new Date(startDate);
      currentDay.setDate(startDate.getDate() + i);
      
      const dayTrades = this.getTradesForDate(currentDay);
      const dayPnL = this.calculateDayPnL(dayTrades);
      const winCount = dayTrades.filter(trade => parseFloat(trade.netProfit) > 0).length;
      const lossCount = dayTrades.filter(trade => parseFloat(trade.netProfit) < 0).length;
      const dailyPercentage = (dayPnL / this.PROP_FIRM_ACCOUNT_VALUE) * 100;
      const totalWinAmount = this.calculateTotalWins(dayTrades);
      const totalLossAmount = this.calculateTotalLosses(dayTrades);

      this.calendarDays.push({
        date: currentDay,
        isCurrentMonth: currentDay.getMonth() === month,
        isToday: this.isToday(currentDay),
        trades: dayTrades,
        pnl: dayPnL,
        tradeCount: dayTrades.length,
        winCount: winCount,
        lossCount: lossCount,
        winRate: dayTrades.length > 0 ? (winCount / dayTrades.length) * 100 : 0,
        dailyPercentage: dailyPercentage,
        totalWinAmount: totalWinAmount,
        totalLossAmount: totalLossAmount
      });
    }

    this.generateWeekSummaries();
  }

  generateWeekSummaries() {
    this.weekSummaries = [];
    
    // Group days by weeks
    for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
      const weekDays = this.calendarDays.slice(weekIndex * 7, (weekIndex + 1) * 7);
      const currentMonthDays = weekDays.filter(day => day.isCurrentMonth);
      
      if (currentMonthDays.length === 0) continue;
      
      const weekPnL = currentMonthDays.reduce((sum, day) => sum + day.pnl, 0);
      const weekTrades = currentMonthDays.reduce((sum, day) => sum + day.tradeCount, 0);
      const activeDays = currentMonthDays.filter(day => day.tradeCount > 0).length;
      const weeklyPercentageGained = (weekPnL / this.PROP_FIRM_ACCOUNT_VALUE) * 100;

      this.weekSummaries.push({
        weekNumber: weekIndex + 1,
        label: `Week ${weekIndex + 1}`,
        totalPnL: weekPnL,
        totalTrades: weekTrades,
        days: activeDays,
        weeklyPercentageGained: weeklyPercentageGained
      });
    }
  }

  getTradesForDate(date: Date): Table[] {
    return this.tableData.filter(trade => {
      const tradeDate = this.parseTradeDate(trade.openDate);
      if (!tradeDate) return false;
      
      return tradeDate.getFullYear() === date.getFullYear() &&
             tradeDate.getMonth() === date.getMonth() &&
             tradeDate.getDate() === date.getDate();
    });
  }

  parseTradeDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    try {
      // Handle MM.DD.YYYY HH:mm format
      const [datePart, timePart] = dateStr.split(' ');
      if (!datePart) return null;

      const [month, day, year] = datePart.split('.');
      if (month && day && year) {
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (timePart) {
          const [hours, minutes] = timePart.split(':');
          if (hours && minutes) {
            date.setHours(parseInt(hours), parseInt(minutes));
          }
        }
        return date;
      }
    } catch (error) {
      console.error('Error parsing trade date:', error);
    }
    
    return null;
  }

  calculateDayPnL(trades: Table[]): number {
    return trades.reduce((sum, trade) => {
      const profit = parseFloat(trade.netProfit) || 0;
      return sum + profit;
    }, 0);
  }

  calculateTotalWins(trades: Table[]): number {
    return trades
      .filter(trade => parseFloat(trade.netProfit) > 0)
      .reduce((sum, trade) => sum + parseFloat(trade.netProfit), 0);
  }

  calculateTotalLosses(trades: Table[]): number {
    return trades
      .filter(trade => parseFloat(trade.netProfit) < 0)
      .reduce((sum, trade) => sum + parseFloat(trade.netProfit), 0);
  }

  isToday(date: Date): boolean {
    const today = new Date();
    return date.getFullYear() === today.getFullYear() &&
           date.getMonth() === today.getMonth() &&
           date.getDate() === today.getDate();
  }

  previousMonth() {
    this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1, 1);
    this.generateCalendar();
  }

  nextMonth() {
    this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 1);
    this.generateCalendar();
  }

  getMonthlyPnL(): number {
    return this.calendarDays
      .filter(day => day.isCurrentMonth)
      .reduce((sum, day) => sum + day.pnl, 0);
  }

  getActiveTradingDays(): number {
    return this.calendarDays
      .filter(day => day.isCurrentMonth && day.tradeCount > 0)
      .length;
  }

  formatCurrency(amount: number): string {
    const absAmount = Math.abs(amount);
    if (absAmount >= 1000) {
      return `${amount < 0 ? '-' : ''}$${(absAmount / 1000).toFixed(1)}K`;
    }
    return `$${amount.toFixed(0)}`;
  }

  formatPercentage(percentage: number): string {
    const sign = percentage >= 0 ? '+' : '';
    return `${sign}${percentage.toFixed(2)}%`;
  }

  getDayPnLClass(pnl: number): string {
    if (pnl > 0) return 'positive';
    if (pnl < 0) return 'negative';
    return 'neutral';
  }

  getMonthlyPnLClass(): string {
    const monthlyPnL = this.getMonthlyPnL();
    if (monthlyPnL > 0) return 'positive';
    if (monthlyPnL < 0) return 'negative';
    return 'neutral';
  }

  getWeekPnLClass(pnl: number): string {
    if (pnl > 0) return 'positive';
    if (pnl < 0) return 'negative';
    return 'neutral';
  }

  getAbsoluteValue(value: number): number {
    return Math.abs(value);
  }

  isWeekday(date: Date): boolean {
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    return dayOfWeek >= 1 && dayOfWeek <= 5; // Monday through Friday
  }
}
