import { Component, ChangeDetectorRef } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from "@angular/common";
import { CalendarModule, CalendarEvent, CalendarMonthViewDay } from 'angular-calendar';
import { Firestore } from '@angular/fire/firestore';
import { DataTablesModule } from 'angular-datatables';
import { Subject } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ReactiveFormsModule } from '@angular/forms';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ConnectionStatusComponent } from '../connection-status/connection-status.component';
import { TradingCalendarComponent } from '../trading-calendar/trading-calendar.component';
import { io, Socket } from "socket.io-client";

declare var $: any;

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

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    ConnectionStatusComponent,
    TradingCalendarComponent,
    MatSlideToggleModule,
    MatCardModule,
    CommonModule,
    CalendarModule,
    DataTablesModule,
    MatProgressBarModule,
    MatButtonModule,
    MatIconModule,
    FormsModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    MatNativeDateModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss', './emotion-tracking.scss']
})
export class DashboardComponent {
  viewDate: Date = new Date();
  events: CalendarEvent[] = [];
  tableData: Table[] = [];
  recentlyAddedTrades: Table[] = [];
  
  // Emotion tracking properties
  currentEmotion: string = '';
  emotionText: string = '';
  isSubmittingEmotion = false;
  showEmotionTracker = false;
  
  // Quick emotion buttons
  quickEmotions = [
    { text: 'FOMO', color: 'warning', icon: 'trending_up' },
    { text: 'Tired', color: 'neutral', icon: 'bedtime' },
    { text: 'Impulsive', color: 'danger', icon: 'flash_on' },
    { text: 'Confident', color: 'success', icon: 'sentiment_very_satisfied' },
    { text: 'Anxious', color: 'warning', icon: 'sentiment_very_dissatisfied' },
    { text: 'Disciplined', color: 'success', icon: 'rule' },
    { text: 'Frustrated', color: 'danger', icon: 'sentiment_dissatisfied' },
    { text: 'Focused', color: 'primary', icon: 'center_focus_strong' }
  ];

  // Basic pagination
  currentPage: number = 1;
  pageSize: number = 10;
  showNotionData = false;

  // Original dashboard properties
  uploadProgress: number = 0;
  isUploading: boolean = false;
  isLoadingChecking = false;
  isLoadingPatching = false;
  isLoadingComparing = false;
  isLoadingPopulating = false;
  checkingError = false;
  patchingError = false;
  comparingError = false;
  populatingError = false;
  progressChecking = 0;
  progressPatching = 0;
  progressComparing = 0;
  progressPopulating = 0;

  // Notion data and column visibility
  notionPerformanceData: any[] = [];
  dtOptionsNotion: any = {};
  dtTriggerNotion: Subject<any> = new Subject<any>();
  isLoadingNotionData = false;
  showLoadButton = true;
  showColumnSelector = false;

  // Column visibility controls
  columnVisibility = {
    id: true,
    action: true,
    date: true,
    account: true,
    status: true,
    buySell: true,
    instrument: true,
    strategy: true,
    lots: true,
    pips: true,
    pnl: true,
    percentPnL: true,
    commission: true,
    swap: true,
    idealRRR: true,
    idealSL: true,
    modelCheck: true,
    rulesViolated: true,
    oneToOneReversal: true,
    reviewed: true,
    dailyReflection: true,
    weeklyRetrospective: true,
    modelForm: false,
    screenshots: false,
    outcome: false,
    held: false,
    percentPnLCalc: false,
    divergenceValue: false,
    formula: false,
    emptySelect: false
  };

  // Available columns for selection
  availableColumns = [
    { key: 'id', label: 'ID', visible: true },
    { key: 'action', label: 'Action', visible: true },
    { key: 'date', label: 'Date', visible: true },
    { key: 'account', label: 'Account', visible: true },
    { key: 'status', label: 'Status', visible: true },
    { key: 'buySell', label: 'Buy/Sell', visible: true },
    { key: 'instrument', label: 'Instrument', visible: true },
    { key: 'strategy', label: 'Strategy', visible: true },
    { key: 'lots', label: 'Lots', visible: true },
    { key: 'pips', label: 'Pips', visible: true },
    { key: 'pnl', label: 'PnL', visible: true },
    { key: 'percentPnL', label: '% PnL', visible: true },
    { key: 'commission', label: 'Commission', visible: true },
    { key: 'swap', label: 'Swap', visible: true },
    { key: 'idealRRR', label: 'Ideal RRR', visible: true },
    { key: 'idealSL', label: 'Ideal SL', visible: true },
    { key: 'modelCheck', label: 'Model✔', visible: true },
    { key: 'rulesViolated', label: 'Rules Violated 🛑', visible: true },
    { key: 'oneToOneReversal', label: '1:1 Reversal', visible: true },
    { key: 'reviewed', label: 'Reviewed', visible: true },
    { key: 'dailyReflection', label: 'Daily Reflection', visible: true },
    { key: 'weeklyRetrospective', label: 'Weekly Retrospective', visible: true },
    { key: 'modelForm', label: 'Model Form', visible: false },
    { key: 'screenshots', label: 'Screenshots', visible: false },
    { key: 'outcome', label: 'Outcome', visible: false },
    { key: 'held', label: 'Held🕕', visible: false },
    { key: 'percentPnLCalc', label: '%PnL-Calc', visible: false },
    { key: 'divergenceValue', label: 'Divergence Value', visible: false },
    { key: 'formula', label: 'Formula', visible: false },
    { key: 'emptySelect', label: 'Empty Select', visible: false }
  ];

  constructor(private firestore: Firestore, private http: HttpClient, private cdr: ChangeDetectorRef) {}

  async ngOnInit() {
    console.log('🚀 Full Dashboard Component initialized');
    
    // Setup socket connection for live trades
    const socket = io("http://localhost:5000", {
      transports: ['websocket'],
      upgrade: false,
    });

    socket.on("connect", () => {
      console.log("✅ Connected to WebSocket server");
    });

    socket.on("trade_opened", (data: any) => {
      console.log("New trade opened:", data);
      this.showEmotionTracker = true;
    });
  }

  // Emotion tracking methods
  selectQuickEmotion(emotion: string): void {
    if (this.currentEmotion === emotion) {
      this.currentEmotion = '';
    } else {
      this.currentEmotion = emotion;
    }
  }

  clearEmotionForm(): void {
    this.currentEmotion = '';
    this.emotionText = '';
  }

  async submitEmotion(): Promise<void> {
    if (!this.currentEmotion && !this.emotionText.trim()) {
      alert('Please select an emotion or enter your feelings.');
      return;
    }

    this.isSubmittingEmotion = true;

    try {
      const emotionData = {
        timestamp: new Date().toISOString(),
        selectedEmotion: this.currentEmotion,
        emotionText: this.emotionText.trim(),
        tradesCount: this.recentlyAddedTrades.length
      };

      console.log('Submitting emotion data:', emotionData);
      
      // Simulate API call to Notion
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      alert(`Emotion recorded successfully!\n\nSelected: ${this.currentEmotion || 'Custom'}\nNotes: ${this.emotionText || 'None'}`);
      
      this.clearEmotionForm();
      this.showEmotionTracker = false;
      this.recentlyAddedTrades = [];

    } catch (error) {
      console.error('Error submitting emotion:', error);
      alert('Failed to submit emotion. Please try again.');
    } finally {
      this.isSubmittingEmotion = false;
    }
  }

  dismissEmotionTracker(): void {
    this.showEmotionTracker = false;
    this.clearEmotionForm();
  }

  // Mock methods for testing
  mockMT5newTrade(): void {
    const mockTrade: Table = {
      openDate: new Date().toLocaleString(),
      tradeNotion: [],
      status: 'New',
      position: 'BUY',
      symbol: 'EURUSD',
      type: 'market',
      volume: '0.10',
      entry: '1.0850',
      sL: '1.0800',
      tP: '1.0900',
      closeDate: '',
      exit: '',
      commission: '0.00',
      swap: '0.00',
      profit: '0.00',
      netProfit: '0.00'
    };

    this.recentlyAddedTrades.push(mockTrade);
    this.tableData.unshift(mockTrade);
    this.showEmotionTracker = true;
    console.log('Mock trade added, emotion tracker shown');
  }

  mockMT5closeTrade(): void {
    if (this.tableData.length > 0) {
      const lastTrade = this.tableData[0];
      lastTrade.closeDate = new Date().toLocaleString();
      lastTrade.exit = '1.0875';
      lastTrade.profit = '25.00';
      lastTrade.netProfit = '25.00';
      lastTrade.status = 'Closed';
      console.log('Mock trade closed');
    }
  }

  // Column management methods
  showDefaultColumns(): void {
    this.columnVisibility = {
      id: true,
      action: true,
      date: true,
      account: true,
      status: true,
      buySell: true,
      instrument: true,
      strategy: true,
      lots: true,
      pips: true,
      pnl: true,
      percentPnL: true,
      commission: true,
      swap: true,
      idealRRR: true,
      idealSL: true,
      modelCheck: true,
      rulesViolated: true,
      oneToOneReversal: true,
      reviewed: true,
      dailyReflection: true,
      weeklyRetrospective: true,
      modelForm: false,
      screenshots: false,
      outcome: false,
      held: false,
      percentPnLCalc: false,
      divergenceValue: false,
      formula: false,
      emptySelect: false
    };
  }

  hideAllColumns(): void {
    Object.keys(this.columnVisibility).forEach(key => {
      this.columnVisibility[key as keyof typeof this.columnVisibility] = false;
    });
  }

  showAllColumns(): void {
    Object.keys(this.columnVisibility).forEach(key => {
      this.columnVisibility[key as keyof typeof this.columnVisibility] = true;
    });
  }

  toggleColumnVisibility(columnKey: string): void {
    this.columnVisibility[columnKey as keyof typeof this.columnVisibility] = !this.columnVisibility[columnKey as keyof typeof this.columnVisibility];
  }

  toggleColumnSelector(): void {
    this.showColumnSelector = !this.showColumnSelector;
  }

  // Notion data methods
  loadNotionDataWithButton(): void {
    this.showLoadButton = false;
    this.isLoadingNotionData = true;
    
    setTimeout(() => {
      this.isLoadingNotionData = false;
      this.notionPerformanceData = [];
      console.log('Notion data loaded');
    }, 2000);
  }

  refreshNotionData(): void {
    this.loadNotionDataWithButton();
  }

  testBackendConnection(): void {
    alert('Testing backend connection...\n\nNote: This is a placeholder. Backend integration can be added later.');
  }

  formatNotionDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (error) {
      return dateStr;
    }
  }

  // Basic utility methods
  toggleNotionData(): void {
    this.showNotionData = !this.showNotionData;
  }

  getFilteredTableData(): Table[] {
    return this.tableData || [];
  }

  getDisplayedRows(): Table[] {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.getFilteredTableData().slice(start, end);
  }

  getTotalPages(): number {
    return Math.ceil(this.getFilteredTableData().length / this.pageSize);
  }

  setPage(page: number): void {
    this.currentPage = page;
  }

  isNewTrade(trade: Table): boolean {
    return this.recentlyAddedTrades.includes(trade);
  }

  getSafeNumber(value: string | number): number {
    if (typeof value === 'number') return value;
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }

  // Basic calculation methods for metrics
  calculateTotalPnL(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    return this.tableData.reduce((total, trade) => {
      const netProfit = parseFloat(trade.netProfit) || 0;
      return total + netProfit;
    }, 0);
  }

  calculatePnLChangePercent(): string {
    return '0.00';
  }

  calculateWinRate(): string {
    if (!this.tableData || this.tableData.length === 0) return '0.00';
    const winningTrades = this.getWinCount();
    const totalTrades = this.getTotalTrades();
    return totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(2) : '0.00';
  }

  getWinCount(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    return this.tableData.filter(trade => {
      const netProfit = parseFloat(trade.netProfit) || 0;
      return netProfit > 0;
    }).length;
  }

  getTotalTrades(): number {
    return this.tableData ? this.tableData.length : 0;
  }

  calculateAvgWin(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    const winningTrades = this.tableData.filter(trade => {
      const netProfit = parseFloat(trade.netProfit) || 0;
      return netProfit > 0;
    });

    if (winningTrades.length === 0) return 0;

    const totalWinAmount = winningTrades.reduce((total, trade) => {
      return total + (parseFloat(trade.netProfit) || 0);
    }, 0);

    return totalWinAmount / winningTrades.length;
  }

  calculateAvgLoss(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    const losingTrades = this.tableData.filter(trade => {
      const netProfit = parseFloat(trade.netProfit) || 0;
      return netProfit < 0;
    });

    if (losingTrades.length === 0) return 0;

    const totalLossAmount = losingTrades.reduce((total, trade) => {
      return total + (parseFloat(trade.netProfit) || 0);
    }, 0);

    return totalLossAmount / losingTrades.length;
  }

  calculateExpectancy(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    const winRate = parseFloat(this.calculateWinRate()) / 100;
    const lossRate = 1 - winRate;
    const avgWin = this.calculateAvgWin();
    const avgLoss = Math.abs(this.calculateAvgLoss());

    return (winRate * avgWin) - (lossRate * avgLoss);
  }

  // Placeholder methods for advanced analytics to prevent template errors
  getRevengeTradingScore(): number { return Math.random() * 30; }
  getOvertradingScore(): number { return Math.random() * 40; }
  getFOMOScore(): number { return Math.random() * 25; }
  getRevengeTradingClass(): string { return 'low-risk'; }
  getOvertradingClass(): string { return 'low-risk'; }
  getFOMOClass(): string { return 'low-risk'; }
  getMaxDrawdown(): number { return -50; }
  getMaxDrawdownPercent(): string { return '1.0'; }
  getCurrentDrawdown(): number { return -10; }
  getRiskRewardRatio(): string { return '1.5'; }
  getStopLossAdherence(): number { return 85; }
  getTakeProfitDiscipline(): number { return 75; }
  getStopLossAdherenceClass(): string { return 'good'; }
  getTakeProfitDisciplineClass(): string { return 'good'; }
  getMaxConsecutiveWins(): number { return 5; }
  getMaxConsecutiveLosses(): number { return 3; }
  getCurrentStreak(): number { return 2; }
  getCurrentStreakClass(): string { return 'positive-streak'; }
  getPerformanceHeatmap(): any[] { return []; }
  getPerformanceInsights(): any[] { return []; }
  hasCriticalInsights(): boolean { return false; }

  // Template helper methods
  isPositiveValue(value: string | number): boolean {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return !isNaN(num) && num > 0;
  }

  isNegativeValue(value: string | number): boolean {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return !isNaN(num) && num < 0;
  }

  getStatusClass(status: string): string {
    return status ? status.toLowerCase() : '';
  }

  getPositionClass(position: string): string {
    return position ? position.toLowerCase() : '';
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch (error) {
      return dateStr;
    }
  }
}
