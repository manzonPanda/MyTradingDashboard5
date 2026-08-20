import { Component, Input, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { SupabaseService } from '../services/supabase.service';

interface Table {
  openDate: string;
  timeOpenPh?: string;
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
  timeClosePh?: string;
  exit: string;
  commission: string;
  swap: string;
  profit: string;
  netProfit: string;
  riskPerTrade?: string;
  rrr?: string;
  mt5status?: string;
  screenshotUrl?: string;
  screenshotUrls?: string[];
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
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <div class="trading-calendar-container">
      <!-- Calendar Header -->
      <div class="calendar-header">
        <div class="calendar-nav">
          <button mat-button class="nav-button" type="button" aria-label="Previous month" title="Previous month" (click)="previousMonth()">
            <mat-icon aria-hidden="true">arrow_back</mat-icon>
          </button>
          <h2 class="month-title">{{ currentDate | date: 'MMMM yyyy' }}</h2>
          <button mat-button class="nav-button" type="button" aria-label="Next month" title="Next month" (click)="nextMonth()">
            <mat-icon aria-hidden="true">arrow_forward</mat-icon>
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
              }"
              role="button"
              tabindex="0"
              [attr.aria-label]="getDayAriaLabel(day)"
              (click)="openDayModal(day)"
              (keydown.enter)="openDayModal(day)"
              (keydown.space)="$event.preventDefault(); openDayModal(day)">
              <div class="new-account-badge" *ngIf="isFirstTradeDay(day.date)">
                <span class="badge-star">★</span>
                <span class="badge-label">New Account</span>
              </div>
              <div class="day-number">{{ day.date.getDate() }}</div>
              <div class="no-trades-badge" *ngIf="day.tradeCount === 0 && !isFutureDate(day.date) && isWeekday(day.date) && !isBeforeAccountStart(day.date)">
                <span class="badge-dot"></span>
                <span class="badge-text">No trades</span>
              </div>
              <div class="day-content" *ngIf="day.tradeCount > 0">
                <!-- Always show percentage on trading days, even if null or 0 -->
                <div class="day-percentage-display" [ngClass]="getDayPnLClass(day.pnl)">
                  {{ formatPercentage(day.dailyPercentage) }}
                </div>

                <div class="day-trades-summary">
                  <div class="trades-count">
                    <span class="win-count">{{ day.winCount }}W</span>
                    <span class="separator">•</span>
                    <span class="loss-count">{{ day.lossCount }}L</span>
                  </div>
                  <div class="day-pnl-amount" [ngClass]="getDayPnLClass(day.pnl)">
                    {{ formatCurrency(day.pnl) }}
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

      <div class="day-trades-modal" *ngIf="selectedDay" role="dialog" aria-modal="true" [attr.aria-label]="'Trades for ' + (selectedDay.date | date: 'MMMM d, y')" (click)="$event.stopPropagation()">
        <div class="day-trades-modal-backdrop" (click)="closeDayModal()"></div>
        <section class="day-trades-modal-panel">
          <header class="day-trades-modal-header">
            <div>
              <span class="day-trades-modal-eyebrow">Trading journal</span>
              <h2>{{ selectedDay.date | date: 'EEEE, MMMM d' }}</h2>
              <p>{{ selectedDay.tradeCount }} {{ selectedDay.tradeCount === 1 ? 'trade' : 'trades' }} captured on this day</p>
            </div>
            <button type="button" class="day-trades-modal-close" aria-label="Close trades for selected day" (click)="closeDayModal()">
              <mat-icon aria-hidden="true">close</mat-icon>
            </button>
          </header>

          <div class="day-trades-summary-strip">
            <div class="day-trades-summary-item">
              <span class="summary-item-label">Day P&amp;L</span>
              <strong [ngClass]="getDayPnLClass(selectedDay.pnl)">{{ formatCurrency(selectedDay.pnl) }}</strong>
            </div>
            <div class="day-trades-summary-item">
              <span class="summary-item-label">Win rate</span>
              <strong>{{ selectedDay.winRate.toFixed(0) }}%</strong>
            </div>
            <div class="day-trades-summary-item">
              <span class="summary-item-label">Wins / losses</span>
              <strong>{{ selectedDay.winCount }} / {{ selectedDay.lossCount }}</strong>
            </div>
          </div>

          <div class="day-trades-modal-body" *ngIf="selectedDay.trades.length > 0; else noDayTrades">
            <article class="day-trade-card" *ngFor="let trade of selectedDay.trades; trackBy: trackByTrade">
              <div class="day-trade-card-main">
                <div class="day-trade-heading">
                  <div>
                    <span class="day-trade-symbol">{{ trade.symbol || 'Unnamed trade' }}</span>
                    <span class="day-trade-direction" [ngClass]="(trade.type || '').toLowerCase() === 'buy' ? 'buy' : 'sell'">{{ trade.type || 'Trade' }}</span>
                  </div>
                  <strong class="day-trade-result" [ngClass]="getDayPnLClass(getTradePnL(trade))">{{ formatCurrency(getTradePnL(trade)) }}</strong>
                </div>
                <div class="day-trade-details">
                  <span><mat-icon aria-hidden="true">schedule</mat-icon>{{ formatTradeTime(trade.timeOpenPh || trade.openDate) }}<ng-container *ngIf="trade.timeClosePh || (trade.closeDate && trade.closeDate !== '-')"> → {{ formatTradeTime(trade.timeClosePh || trade.closeDate) }}</ng-container></span>
                  <span><mat-icon aria-hidden="true">confirmation_number</mat-icon>#{{ trade.position || '—' }}</span>
                  <span *ngIf="trade.volume"><mat-icon aria-hidden="true">layers</mat-icon>{{ trade.volume }} lots</span>
                </div>
                <div class="day-trade-metrics">
                  <span *ngIf="trade.riskPerTrade">Risk <strong>{{ formatCurrency(getNumericValue(trade.riskPerTrade)) }}</strong></span>
                  <span *ngIf="trade.rrr">R:R <strong>{{ trade.rrr }}</strong></span>
                  <span *ngIf="trade.mt5status">{{ trade.mt5status }}</span>
                </div>
              </div>
              <div class="day-trade-media">
                <div class="day-trade-screenshot-gallery" *ngIf="trade.screenshotUrls?.length; else screenshotState">
                  <div class="day-trade-screenshot-tile" *ngFor="let screenshotUrl of trade.screenshotUrls; let screenshotIndex = index">
                    <img [src]="screenshotUrl" [alt]="(trade.symbol || 'Trade') + ' screenshot ' + (screenshotIndex + 1)" loading="lazy">
                    <div class="screenshot-tile-actions">
                      <button type="button" class="screenshot-action-button" aria-label="View screenshot" title="View screenshot" (click)="openScreenshot(screenshotUrl)">
                        <mat-icon aria-hidden="true">visibility</mat-icon>
                      </button>
                      <button type="button" class="screenshot-action-button screenshot-delete-button" aria-label="Delete screenshot" title="Delete screenshot" [disabled]="isDeletingScreenshot(screenshotUrl)" (click)="requestDeleteScreenshot(screenshotUrl)">
                        <mat-icon aria-hidden="true">delete</mat-icon>
                      </button>
                    </div>
                    <div class="screenshot-delete-confirmation" *ngIf="confirmingDeleteUrl === screenshotUrl">
                      <strong>Confirm delete?</strong>
                      <div class="screenshot-confirmation-actions">
                        <button type="button" class="screenshot-confirm-button" [disabled]="isDeletingScreenshot(screenshotUrl)" (click)="deleteScreenshot(trade, screenshotUrl)">Delete</button>
                        <button type="button" class="screenshot-cancel-button" [disabled]="isDeletingScreenshot(screenshotUrl)" (click)="cancelDeleteScreenshot()">Cancel</button>
                      </div>
                    </div>
                  </div>
                </div>
                <ng-template #screenshotState>
                  <div class="day-trade-screenshot day-trade-screenshot-empty" *ngIf="isLoadingScreenshots(trade); else noScreenshot">
                    <span class="screenshot-loading-spinner" aria-hidden="true"></span>
                    <span>Loading screenshots...</span>
                  </div>
                </ng-template>
                <ng-template #noScreenshot>
                  <div class="day-trade-screenshot day-trade-screenshot-empty">
                    <mat-icon aria-hidden="true">image_not_supported</mat-icon>
                    <span>No screenshot yet</span>
                  </div>
                </ng-template>
                <div
                  class="trade-screenshot-upload"
                  [class.is-uploading]="isUploadingScreenshots(trade)"
                  [class.is-dragging]="isDraggingScreenshots(trade)"
                  (dragover)="onScreenshotDragOver(trade, $event)"
                  (dragleave)="onScreenshotDragLeave(trade, $event)"
                  (drop)="onScreenshotDrop(trade, $event)">
                  <input type="file" accept="image/*" multiple [disabled]="isUploadingScreenshots(trade)" (change)="uploadTradeScreenshots(trade, $event)">
                  <mat-icon aria-hidden="true">cloud_upload</mat-icon>
                  <span>{{ isUploadingScreenshots(trade) ? 'Uploading...' : 'Drop images here or browse' }}</span>
                  <small>Multiple images supported</small>
                </div>
                <span class="trade-screenshot-upload-error" *ngIf="getScreenshotUploadError(trade)">{{ getScreenshotUploadError(trade) }}</span>
              </div>
            </article>
          </div>
          <ng-template #noDayTrades>
            <div class="day-trades-empty-state">
              <mat-icon aria-hidden="true">event_busy</mat-icon>
              <h3>No trades recorded</h3>
              <p>This day is ready for your next journal entry.</p>
            </div>
          </ng-template>
        </section>
        <div class="screenshot-lightbox" *ngIf="activeScreenshotUrl" role="dialog" aria-modal="true" aria-label="Screenshot preview" (click)="closeScreenshot()">
          <button type="button" class="screenshot-lightbox-close" aria-label="Close screenshot preview" (click)="closeScreenshot()">
            <mat-icon aria-hidden="true">close</mat-icon>
          </button>
          <img [src]="activeScreenshotUrl" alt="Trade screenshot enlarged" (click)="$event.stopPropagation()">
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./trading-calendar.component.scss']
})
export class TradingCalendarComponent implements OnInit, OnChanges {
  @Input() tableData: Table[] = [];
  @Input() viewDate: Date = new Date();
  @Input() accountId: string | null = null;

  currentDate: Date = new Date();
  calendarDays: CalendarDay[] = [];
  weekSummaries: WeekSummary[] = [];
  firstTradeDate: Date | null = null;
  selectedDay: CalendarDay | null = null;
  private readonly uploadingScreenshotTickets = new Set<string>();
  private readonly screenshotUploadErrors = new Map<string, string>();
  private readonly deletingScreenshotUrls = new Set<string>();
  private readonly draggingScreenshotTickets = new Set<string>();
  activeScreenshotUrl: string | null = null;
  confirmingDeleteUrl: string | null = null;
  private readonly screenshotLoadedTickets = new Set<string>();
  private readonly screenshotLoadingTickets = new Set<string>();

  readonly PROP_FIRM_ACCOUNT_VALUE = 2500; // $5k prop firm account
  weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  constructor(private readonly supabaseService: SupabaseService) {}

  ngOnInit() {
    this.currentDate = this.viewDate || new Date();
    this.firstTradeDate = this.getFirstTradeDate();
    this.generateCalendar();
  }

  ngOnChanges(changes: SimpleChanges) {
    // Regenerate whenever the table data, the viewed month, OR the active account
    // changes. Watching accountId guarantees the calendar always refreshes when
    // the user switches/previews a different prop-firm account in the UI, even if
    // tableData's reference doesn't change (e.g. two accounts with no trades).
    if (changes['tableData'] || changes['viewDate'] || changes['accountId']) {
      if (changes['viewDate'] && changes['viewDate'].currentValue) {
        this.currentDate = new Date(changes['viewDate'].currentValue);
      }
      this.firstTradeDate = this.getFirstTradeDate();
      this.screenshotLoadedTickets.clear();
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

      const tradeDateForComparison = new Date(tradeDate);

      // Keep overnight trades grouped with the prior trading day.
      if (tradeDate.getHours() < 3) {
        tradeDateForComparison.setDate(tradeDateForComparison.getDate() - 1);
      }

      return tradeDateForComparison.getFullYear() === date.getFullYear() &&
             tradeDateForComparison.getMonth() === date.getMonth() &&
             tradeDateForComparison.getDate() === date.getDate();
    });
  }

  parseTradeDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    try {
      const [datePart, timePart] = dateStr.replace('T', ' ').split(' ');
      if (!datePart) return null;

      const dateParts = datePart.split(/[.-]/);
      if (dateParts.length !== 3) return null;
      const [first, second, third] = dateParts.map(Number);
      const year = dateParts[0].length === 4 ? first : third;
      const month = dateParts[0].length === 4 ? second : first;
      const day = dateParts[0].length === 4 ? third : second;
      if (![year, month, day].every(Number.isFinite)) return null;

      const date = new Date(year, month - 1, day);
      if (timePart) {
        const [hours, minutes] = timePart.split(':').map(Number);
        if (Number.isFinite(hours) && Number.isFinite(minutes)) {
          date.setHours(hours, minutes);
        }
      }
      return date;
    } catch (error) {
      console.error('Error parsing trade date:', error);
    }

    return null;
  }

  private normalizeDate(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private getFirstTradeDate(): Date | null {
    if (!this.tableData || this.tableData.length === 0) return null;
    let earliest: Date | null = null;
    for (const trade of this.tableData) {
      const d = this.parseTradeDate(trade.openDate);
      if (!d) continue;
      if (!earliest || d < earliest) earliest = d;
    }
    return earliest ? this.normalizeDate(earliest) : null;
  }

  isFirstTradeDay(date: Date): boolean {
    if (!this.firstTradeDate) return false;
    const normalized = this.normalizeDate(date);
    return this.isSameDay(normalized, this.firstTradeDate);
  }

  calculateDayPnL(trades: Table[]): number {
    return trades.reduce((sum, trade) => {
      const profit = parseFloat(trade.netProfit) || 0;
      return sum + profit;
    }, 0);
  }

  isToday(date: Date): boolean {
    const today = new Date();
    return date.getFullYear() === today.getFullYear() &&
           date.getMonth() === today.getMonth() &&
           date.getDate() === today.getDate();
  }

  async openDayModal(day: CalendarDay): Promise<void> {
    this.selectedDay = day;

    const tickets = day.trades
      .map(trade => String(trade.position))
      .filter(ticket => ticket && !this.screenshotLoadedTickets.has(ticket) && !this.screenshotLoadingTickets.has(ticket));
    if (!tickets.length) return;

    tickets.forEach(ticket => this.screenshotLoadingTickets.add(ticket));
    try {
      const screenshotUrls = await this.supabaseService.getTradeScreenshotUrls(tickets);
      for (const trade of day.trades) {
        const urls = screenshotUrls[String(trade.position)] || [];
        if (urls.length) {
          trade.screenshotUrls = [...new Set([...(trade.screenshotUrls || []), ...urls])];
          trade.screenshotUrl = trade.screenshotUrls[0];
        }
        this.screenshotLoadedTickets.add(String(trade.position));
      }
      this.selectedDay = { ...day, trades: [...day.trades] };
    } catch (error) {
      console.warn('Unable to load screenshots for selected day:', error);
    } finally {
      tickets.forEach(ticket => this.screenshotLoadingTickets.delete(ticket));
    }
  }

  closeDayModal(): void {
    this.selectedDay = null;
  }

  isUploadingScreenshots(trade: Table): boolean {
    return this.uploadingScreenshotTickets.has(String(trade.position));
  }

  isLoadingScreenshots(trade: Table): boolean {
    return this.screenshotLoadingTickets.has(String(trade.position));
  }

  isDraggingScreenshots(trade: Table): boolean {
    return this.draggingScreenshotTickets.has(String(trade.position));
  }

  onScreenshotDragOver(trade: Table, event: DragEvent): void {
    event.preventDefault();
    if (!this.isUploadingScreenshots(trade)) {
      this.draggingScreenshotTickets.add(String(trade.position));
    }
  }

  onScreenshotDragLeave(trade: Table, event: DragEvent): void {
    event.preventDefault();
    this.draggingScreenshotTickets.delete(String(trade.position));
  }

  onScreenshotDrop(trade: Table, event: DragEvent): void {
    event.preventDefault();
    this.draggingScreenshotTickets.delete(String(trade.position));
    if (this.isUploadingScreenshots(trade)) return;

    const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
    void this.uploadTradeScreenshotFiles(trade, files);
  }

  getScreenshotUploadError(trade: Table): string {
    return this.screenshotUploadErrors.get(String(trade.position)) || '';
  }

  isDeletingScreenshot(screenshotUrl: string): boolean {
    return this.deletingScreenshotUrls.has(screenshotUrl);
  }

  openScreenshot(screenshotUrl: string): void {
    this.activeScreenshotUrl = screenshotUrl;
  }

  closeScreenshot(): void {
    this.activeScreenshotUrl = null;
  }

  requestDeleteScreenshot(screenshotUrl: string): void {
    this.confirmingDeleteUrl = screenshotUrl;
  }

  cancelDeleteScreenshot(): void {
    this.confirmingDeleteUrl = null;
  }

  async deleteScreenshot(trade: Table, screenshotUrl: string): Promise<void> {
    this.deletingScreenshotUrls.add(screenshotUrl);
    try {
      await this.supabaseService.deleteTradeScreenshot(trade.position, screenshotUrl);
      trade.screenshotUrls = (trade.screenshotUrls || []).filter(url => url !== screenshotUrl);
      trade.screenshotUrl = trade.screenshotUrls[0];
      if (this.activeScreenshotUrl === screenshotUrl) this.closeScreenshot();
      if (this.confirmingDeleteUrl === screenshotUrl) this.cancelDeleteScreenshot();
      this.selectedDay = this.selectedDay ? { ...this.selectedDay, trades: [...this.selectedDay.trades] } : this.selectedDay;
    } catch (error) {
      this.screenshotUploadErrors.set(String(trade.position), error instanceof Error ? error.message : 'Unable to delete screenshot.');
    } finally {
      this.deletingScreenshotUrls.delete(screenshotUrl);
    }
  }

  async uploadTradeScreenshots(trade: Table, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    await this.uploadTradeScreenshotFiles(trade, files);
  }

  private async uploadTradeScreenshotFiles(trade: Table, files: File[]): Promise<void> {
    if (!files.length || !trade.position) return;

    const ticket = String(trade.position);
    this.uploadingScreenshotTickets.add(ticket);
    this.screenshotUploadErrors.delete(ticket);

    try {
      const uploadedUrls = await Promise.all(files.map(file =>
        this.supabaseService.uploadTradeScreenshot(trade.position, file, trade.symbol)
      ));
      trade.screenshotUrls = [...new Set([...(trade.screenshotUrls || []), ...uploadedUrls])];
      trade.screenshotUrl = trade.screenshotUrls[0];
      this.selectedDay = this.selectedDay ? { ...this.selectedDay, trades: [...this.selectedDay.trades] } : this.selectedDay;
    } catch (error) {
      this.screenshotUploadErrors.set(ticket, error instanceof Error ? error.message : 'Unable to upload screenshots.');
    } finally {
      this.uploadingScreenshotTickets.delete(ticket);
    }
  }

  getDayAriaLabel(day: CalendarDay): string {
    return `${day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${day.tradeCount} ${day.tradeCount === 1 ? 'trade' : 'trades'}`;
  }

  trackByTrade(index: number, trade: Table): string | number {
    return trade.position || index;
  }

  getTradePnL(trade: Table): number {
    return parseFloat(trade.netProfit || trade.profit || '0') || 0;
  }

  getNumericValue(value: string | number | undefined): number {
    return parseFloat(String(value || '0')) || 0;
  }

  formatTradeTime(value: string): string {
    const date = this.parseTradeDate(value);
    return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : value || '—';
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
    return `$${amount.toFixed(2)}`;
  }

  formatPercentage(percentage: number | null | undefined): string {
    // Handle null, undefined, or NaN values
    const safePercentage = (percentage === null || percentage === undefined || isNaN(percentage)) ? 0 : percentage;
    const sign = safePercentage >= 0 ? '+' : '';
    return `${sign}${safePercentage.toFixed(2)}%`;
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

  isWeekday(date: Date): boolean {
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    return dayOfWeek >= 1 && dayOfWeek <= 5; // Monday through Friday
  }

  isFutureDate(date: Date): boolean {
    const now = new Date();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return date.getTime() > endOfToday.getTime();
  }

  isBeforeAccountStart(date: Date): boolean {
    if (!this.firstTradeDate) return false;
    const normalized = this.normalizeDate(date);
    return normalized.getTime() < this.firstTradeDate.getTime();
  }
}
