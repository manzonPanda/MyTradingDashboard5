import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCardModule  } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from "@angular/common";
import { CalendarModule, CalendarEvent,CalendarMonthViewDay   } from 'angular-calendar';
import * as XLSX from 'xlsx';
import { Firestore, collection, addDoc, setDoc, doc,getDocs,onSnapshot   } from '@angular/fire/firestore';
import { addMonths, subMonths } from 'date-fns';
import { DataTablesModule  } from 'angular-datatables';
import { Subject } from 'rxjs';
import * as DataTables from 'datatables.net';
import 'datatables.net'; // Ensure DataTables functionality is available
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ReactiveFormsModule } from '@angular/forms';
import { MatNativeDateModule } from '@angular/material/core'; // for default JS Date support
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { ConnectionStatusComponent } from '../connection-status/connection-status.component';
import { TradingCalendarComponent } from '../trading-calendar/trading-calendar.component';
import { DreamTimelineComponent } from '../dream-timeline/dream-timeline.component';
import { io, Socket } from "socket.io-client";
import { Chart, ChartConfiguration, ChartOptions, ChartType, registerables } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FcmService } from '../services/fcm.service';
import { NewsReminderService } from '../services/news-reminder.service';
import { ConfettiService } from '../services/confetti.service';

declare var $: any;

interface Relation {
  relationName: string;
  relationId: string;
}

interface Trades {
  tradeDate: string;
  tradeId: string;
}

interface AccountSettings {
  startingBalance: number;
  balance:number;
  profitTarget: number;
  maxTotalDrawdown: number;
  dailyLossLimit: number;
}

interface Table {
  openDate: string;
  tradeNotion: Trades[];
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
  riskPerTrade: string; // New field for risk per trade
  rrr:string;
  mt5status:string;// if trade is live(open) or closed in MT5
  mfe: string; // Maximum Favorable Excursion - tracks highest unrealized profit
}

interface NotionPerformanceData {
  id: string;
  action: string; // title
  date: string; // date
  idealRRR: string; // select
  buySell: string; // select
  modelCheck: string[]; // multi_select
  status: string; // status
  percentPnL: number; // number
  weeklyRetrospective: string; // rich_text
  account: string[]; // multi_select
  strategy: string; // select
  oneToOneReversal: boolean; // checkbox
  screenshots: string[]; // files
  modelForm: string[]; // multi_select
  idealSL: string; // select
  reviewed: boolean; // checkbox
  uniqueID: number; // unique_id
  commission: number; // number
  outcome: string[]; // files
  held: string; // formula
  instrument: string; // select
  pnl: number; // number
  percentPnLCalc: string; // formula
  dailyReflection: string; // rich_text
  lots: number; // number
  divergenceValue: number; // number
  pips: number; // number
  formula: number; // formula
  rulesViolated: string[]; // multi_select
  emptySelect: string; // select (empty name)
  swap: number; // number
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    ConnectionStatusComponent,
    TradingCalendarComponent,
    DreamTimelineComponent,
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
    MatProgressSpinnerModule,
    BaseChartDirective
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss', './insights-additional.scss', './notion-performance.scss', './column-selector.scss', './trading-settings.scss', '../dream-timeline/dream-timeline-integration.scss', '../dream-timeline/dream-timeline-header.scss']
})


// @Injectable({ providedIn: 'root' })
export class DashboardComponent implements AfterViewInit {
  // Additional calculation methods for missing functions
  @ViewChild(BaseChartDirective) chart?: BaseChartDirective;
  viewDate: Date = new Date();
  events: CalendarEvent[] = [];
  locale: string = 'en';
  rawData: any[] = [];
  // Active Account Table
  tableData: Table[] = []; // Initialize as empty array
  dtOptions: any = {}; // Use 'any' or type the object more specifically later
  dtTrigger: Subject<any> = new Subject<any>();

  // MT5 Live Trading properties
mt5AccountInfo: AccountSettings = {
  startingBalance: 0,
  balance: 0,
  profitTarget: 0,
  maxTotalDrawdown: 0,
  dailyLossLimit: 0
};
  mt5LiveTrades: Table[] = []; // Live trades from MT5
  isLoadingMT5Data = false;
  isLoadingMetrics = true; // Loading state for metrics cards
  mockTicket = Math.floor(Math.random() * 999999999) + 100000000;
  //uploading progress bar
  uploadProgress: number = 0;
  isUploading: boolean = false;
  showProgressBar = false;
  hideProgressBar = false;
  startDate: Date | null = null;
  endDate: Date | null = null;
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
  relations: Relation[] = [];
  trades: Trades[] = [];
  showNotionData = false;
  // selectedTradeId: string | null = null;
  selectedTradeId: { [position: string]: string | null } = {};


  //news data from ForexFactory
  newsData: any[] = [];
  isNewsLoading: boolean = true;
  selectedDay: number = new Date().getDay(); // Current day
  timeGroupStates: { [key: string]: boolean } = {}; // Track expanded states
  showNewsModal: boolean = false;
  selectedTimeGroup: any = null;

  // Simple pagination properties
  currentPage: number = 1;
  pageSize: number = 10;

  // Live trade tracking
  recentlyAddedTrades: Table[] = [];

  // News reminder properties
  showReminderDetails: boolean = false;

  // Emotional tracking properties for individual trades
  predefinedEmotions = [
    { name: 'FOMO', icon: '😰', color: '#f59e0b' },
    { name: 'Confident', icon: '😎', color: '#10b981' },
    { name: 'Tired', icon: '😴', color: '#6b7280' },
    { name: 'Impulsive', icon: '⚡', color: '#ef4444' },
    { name: 'Focused', icon: '🎯', color: '#3b82f6' },
    { name: 'Anxious', icon: '😟', color: '#f59e0b' },
    { name: 'Greedy', icon: '🤑', color: '#ef4444' },
    { name: 'Patient', icon: '🧘', color: '#10b981' },
    { name: 'Frustrated', icon: '😤', color: '#ef4444' },
    { name: 'Disciplined', icon: '💪', color: '#10b981' },
    { name: 'Overwhelmed', icon: '😵', color: '#f59e0b' },
    { name: 'Calm', icon: '😌', color: '#10b981' }
  ];

  // Individual emotional states for each trade
  tradeEmotionalStates: { [tradeKey: string]: any } = {};
  emotionalEntries: any[] = [];

  // Overall Trading History Table
  notionPerformanceData: NotionPerformanceData[] = [];
  dtOptionsNotion: any = {};
  dtTriggerNotion: Subject<any> = new Subject<any>();
  isLoadingNotionData = false;
  showLoadButton = true; // Controls whether to show load button or table

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

  showColumnSelector = false;
  private isRefreshingTable = false;

  // Backend configuration
  private BACKEND_URL = 'http://localhost:3000'; // This will be overridden in cloud environments

  // Trading settings properties
  profitTarget: number = 5; // Default 5%
  maxLoss: number = 2; // Default 2%

  // Confetti celebration tracking
  private lastCelebratedTarget: number = 0;
  private hasCelebratedCurrentTarget: boolean = false;

  // Chart configuration for beautiful trading visualization
  public chartType: ChartType = 'line';
  public chartLabels: string[] = [];
  public chartData: any = {
    labels: [],
    datasets: [
      {
        label: 'Account Balance',
        data: [],
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: 'rgb(16, 185, 129)',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8,
        shadowOffsetX: 0,
        shadowOffsetY: 4,
        shadowBlur: 10,
        shadowColor: 'rgba(16, 185, 129, 0.3)'
      },
      {
        label: 'Cumulative P&L',
        data: [],
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.05)',
        borderWidth: 2,
        fill: false,
        tension: 0.3,
        pointBackgroundColor: 'rgb(59, 130, 246)',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      },
      {
        label: 'Drawdown',
        data: [],
        borderColor: 'rgb(239, 68, 68)',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: 'rgb(239, 68, 68)',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5
      }
    ]
  };

  public chartOptions: ChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 2000,
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
        labels: {
          usePointStyle: true,
          padding: 20,
          font: {
            size: 12,
            weight: 'normal'
          },
          color: '#64748b',
          filter: function(legendItem: any) {
            // Show main chart elements in legend, hide profit target and max loss text
            return legendItem.text === 'Account Balance' ||
                   legendItem.text.includes('Current P&L') ||
                   legendItem.text === '🟣 --- Starting Balance';
          }
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
        filter: function(tooltipItem: any) {
          // Only show tooltips for Account Balance, not for reference lines
          return tooltipItem.dataset.label === 'Account Balance';
        },
        callbacks: {
          title: function(context: any) {
            return context[0].label;
          },
          label: function(context: any) {
            const value = context.parsed.y;
            const index = context.dataIndex;
            const data = context.dataset.data;

            // Handle Account Balance tooltip
            if (index === 0) {
              return `Starting Balance: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            } else {
              const previousValue = data[index - 1];
              const change = value - previousValue;
              const changeText = change >= 0 ? `+$${change.toFixed(2)}` : `-$${Math.abs(change).toFixed(2)}`;
              return [
                `Balance: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                `Trade P&L: ${changeText}`
              ];
            }
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
            size: 14,
            weight: 'normal'
          },
          color: '#64748b'
        }
      },
      y: {
        display: true,
        grid: {
          display: true,
          color: 'rgba(0, 0, 0, 0.08)',
          lineWidth: 1
        },
        ticks: {
          maxTicksLimit: 15,
          stepSize: 50,
          font: {
            size: 13,
            weight: 'normal'
          },
          color: '#64748b',
          callback: function(value: any) {
            return '$' + value.toLocaleString('en-US', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0
            });
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
  };



  constructor(private firestore: Firestore, private fcm: FcmService, private http: HttpClient, private cdr: ChangeDetectorRef, private newsReminder: NewsReminderService, private confetti: ConfettiService) {
    // Register Chart.js components
    Chart.register(...registerables);
  }

  // Math utility methods for template calculations
  mathMin(a: number, b: number): number {
    return Math.min(a, b);
  }

  mathAbs(value: number): number {
    return Math.abs(value);
  }

  // Trade statistics calculation methods
  calculateWinRate(): number {
    const totalTrades = this.getTotalTrades();
    if (totalTrades === 0) return 0;

    const winningTrades = this.getWinCount();
    return Math.round((winningTrades / totalTrades) * 100);
  }

  getWinCount(): number {
    return this.tableData.filter(trade => {
      const netProfit = this.getSafeNumber(trade.netProfit);
      return netProfit > 0;
    }).length;
  }

  getLossCount(): number {
    return this.tableData.filter(trade => {
      const netProfit = this.getSafeNumber(trade.netProfit);
      return netProfit < 0;
    }).length;
  }

  getBreakevenCount(): number {
    return this.tableData.filter(trade => {
      const netProfit = this.getSafeNumber(trade.netProfit);
      return netProfit === 0;
    }).length;
  }

  getTotalTrades(): number {
    return this.tableData.length;
  }

  getSafeNumber(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    return isNaN(num) ? 0 : num;
  }

  // Simple gauge chart methods for Trade Win %
  getSimpleGaugeColor(): string {
    const winRate = this.calculateWinRate();
    if (winRate >= 60) return '#10b981'; // Green for 60%+
    if (winRate >= 40) return '#f59e0b'; // Yellow for 40-59%
    return '#ef4444'; // Red for <40%
  }

  getSimpleGaugeDash(): string {
    const circumference = Math.PI * 60; // Half circle circumference (radius 60)
    return `${circumference} ${circumference}`;
  }

  getSimpleGaugeOffset(): number {
    const winRate = this.calculateWinRate();
    const circumference = Math.PI * 60;
    const progress = (100 - winRate) / 100;
    return circumference * progress;
  }

  // Removed dummy data method as requested by user
  private async loadTradingSettings(): Promise<void> {
    const body = {
      "page_size": 1,
      "filter": {
        "property": "Account",
        "multi_select": {
          "contains": "5ers4️⃣5k [#25475923]"
        }
      },
      "sorts": [
        {
          "timestamp": "created_time",
          "direction": "ascending"
        }
      ]
    };
    try {
      const accountSettings: any = await firstValueFrom(
        this.http.post("http://localhost:3000/api/getPropFirmAccountSettings", body) //Patching
      );
      if (accountSettings.results[0]) {
        const info = accountSettings.results[0].properties["Daily Reflection"]?.rich_text?.[0]?.plain_text || "";
        const startingBalance = info.match(/InitialBalance:\s*(\d+)/i)?.[1] || null;
        const profitTarget = info.match(/ProfitTarget:\s*([\d.]+%)/i)?.[1] || null;
        const maxTotalDrawdown = info.match(/MaxTotalDrawdown:\s*([\d.]+%)/i)?.[1] || null;
        const dailyLossLimit = info.match(/DailyLossLimit:\s*([\d.]+%)/i)?.[1] || null;
        this.mt5AccountInfo.startingBalance = parseInt(startingBalance)
        this.mt5AccountInfo.profitTarget = parseInt(profitTarget.replace('%', ''))
        this.mt5AccountInfo.maxTotalDrawdown = parseInt(maxTotalDrawdown.replace('%', ''))
        this.mt5AccountInfo.dailyLossLimit = parseInt(dailyLossLimit.replace('%', ''))

        // Refresh chart with updated MT5 account info
        setTimeout(() => {
          this.generateTradingChartData();
        }, 100);

      }
    } catch (error) {
      console.warn('⚠️ Could not load MT5 account settings from backend');
    }
  }

async ngOnInit() {
    // Load saved trading settings
    this.loadTradingSettings();

    const socket = io("http://localhost:5000",{
      transports: ['websocket'], // ��� Force WebSocket to avoid polling
      upgrade: false,              // Optional, disables fallback to long-polling
    });

  socket.on("connect", async () => {
    console.warn("✅ Connected to WebSocket server");
    // Set metrics loading to false after connection
    this.isLoadingMetrics = false;
    await this.loadMT5Data(); // Load MT5 trades
  });

  socket.on("account_info", (data) => {
    if (this.mt5AccountInfo) {
      this.mt5AccountInfo.balance = data.balance;
    }
    console.warn("���� Account Info Received:", data);
  });

  socket.on("connect_error", (err: any) => {
    console.warn("❌ Socket connection error:", err);
    // Even if socket fails, show the metrics (they'll just be 0)
    this.isLoadingMetrics = false;
  });

  socket.on("trade_opened", (data: any) => {
    console.warn("New trade opened:", data);
    this.addMT5LiveTrade(data);
  });

  socket.on("trade_closed", (data: any) => {
    console.warn("Trade closed:", data);
    this.closeMT5Trade(data);
  });

  socket.on('price_update', (data: any) => {
    console.log("Live price update:", data);
    this.updateMT5TradePrice(data);
  });

  try {
    const news: any = await firstValueFrom(
      this.http.get("http://localhost:3000/api/news")
    );
    this.newsData = Array.isArray(news) ? news : [];
    console.log("📈 Forex Factory News Data:", this.newsData);

    // Schedule news reminders if FCM is ready
    if (this.newsData.length > 0) {
      // Delay scheduling to ensure FCM is set up
      setTimeout(() => {
        this.newsReminder.scheduleAllReminders(this.newsData);
      }, 1000);
    }
  } catch (error) {
    console.warn("⚠️ Failed to load forex news:", error);
    this.newsData = [];
  } finally {
    this.isNewsLoading = false;
  }

  //Firebase Cloud Messaging setup
  const token = await this.fcm.requestPermission();
  if (token) {
    // You would store this token in your backend DB tied to the user
    this.fcm.listen();

    // Set up news reminder callback
    this.newsReminder.setSendNotificationCallback((title: string, body: string) => {
      this.sendNotif(token, title, body);
    });

    // Schedule reminders for loaded news
    if (this.newsData && this.newsData.length > 0) {
      this.newsReminder.scheduleAllReminders(this.newsData);
    }
  }

  this.dtOptions = {
    paging: true,
    searching: true,
    ordering: true,
    pageLength: 10,
    processing: false,
    responsive: true,
    keys: true,
    retrieve: true,
    language: {
      emptyTable: "No trading data available",
      info: "Showing _START_ to _END_ of _TOTAL_ trades",
      infoEmpty: "Showing 0 to 0 of 0 trades",
      lengthMenu: "Show _MENU_ trades per page"
    }
  };

    this.dtOptionsNotion = {
      destroy: true,
      paging: true,
      searching: true,
      ordering: true,
      pageLength: 10,
      processing: true,
      responsive: true,
      keys: true,
      order: [[1, 'desc']], // Sort by date descending by default
      columnDefs: [
        { targets: [2, 3, 5, 6, 7, 8, 9, 10], className: 'text-center' }, // Center align numeric columns
        { targets: [2, 5, 6, 7, 8, 9, 10], type: 'num' } // Specify numeric sorting
      ]
    };

    localStorage.clear();

    // await this.loadTrades(); // Load trades from Firestore
    // await this.loadMT5Data(); // Load MT5 trades
    // this.addTradesToCalendar(); // Add trades to calendar events

 

    // Simple table - no DataTables initialization needed!
    console.log('✅ Simple Angular table ready - no DataTables complexity!');

    // Generate initial chart data
    this.generateTradingChartData();

    // Set loading to false after a short delay to show metrics even without data
    setTimeout(() => {
      this.isLoadingMetrics = false;
    }, 3000);

    // Removed dummy data as requested by user
  }

  ngAfterViewInit() {
    // Initialize the stunning trading chart
    setTimeout(() => {
      this.generateTradingChartData();
    }, 1000);
  }

  initializeDataTable(): void {
    try {
      console.log('🚀 Initializing DataTable with', this.tableData.length, 'rows');

      // Use Angular DataTables trigger for complex column support
      this.dtTrigger.next(null);
      console.log('✅ DataTable initialized successfully');

    } catch (error) {
      console.error('❌ Error initializing DataTable:', error);
    }
  }

  refreshDataTableWithAngularBinding(): void {
    try {
      console.log('🔄 Refreshing DataTable with Angular binding for complex columns');

      // Force Angular change detection first
      this.cdr.detectChanges();

      // For Angular DataTables, we need to destroy and recreate to pick up new data
      setTimeout(() => {
        if ($.fn.dataTable.isDataTable('#myTable')) {
          console.log('🗑️ Destroying existing Angular DataTable');
          $('#myTable').DataTable().destroy();
        }

        // Trigger recreation with new data
        setTimeout(() => {
          this.dtTrigger.next(null);
          console.log('✅ DataTable refreshed with Angular binding');
        }, 100);
      }, 50);

    } catch (error) {
      console.error('❌ Error refreshing DataTable with Angular binding:', error);
    }
  }

  ngOnDestroy(): void {
    this.dtTrigger.unsubscribe();
    this.dtTriggerNotion.unsubscribe();

    // Safely clean up the DataTables when the component is destroyed
    try {
      if ($.fn.dataTable.isDataTable('#myTable')) {
        const myTable = $('#myTable').DataTable();
        if (myTable && typeof myTable.destroy === 'function') {
          myTable.destroy(true);
        }
      }
    } catch (error) {
      console.warn('Error destroying myTable:', error);
    }

    try {
      if ($.fn.dataTable.isDataTable('#notionTable')) {
        const notionTable = $('#notionTable').DataTable();
        if (notionTable && typeof notionTable.destroy === 'function') {
          notionTable.destroy(true);
        }
      }
    } catch (error) {
      console.warn('Error destroying notionTable:', error);
    }
  }

  private triggerDataTableRender(): void {
    // Add a small delay to ensure DOM is ready
    setTimeout(() => {
      try {
        const tableElement = document.getElementById('notionTable');
        if (tableElement && this.notionPerformanceData.length > 0) {
          this.dtTriggerNotion.next(null);
        } else {
          console.warn('Table element not found or no data available for DataTable rendering');
        }
      } catch (error) {
        console.error('Error triggering DataTable render:', error);
      }
    }, 150);
  }
  
  addMonth(date: Date): Date {
    return addMonths(date, 1);
  }
  
  subMonth(date: Date): Date {
    return subMonths(date, 1);
  }

 addTradesToCalendar() {
  // console.log("tableData::"+this.tableData)
    this.tableData.forEach(row => {
      const tradeDateString = row.openDate; // Column 0: the date string
      const symbol = row.symbol;           // Column 2: symbol
      const type = row.type || '';         // Use the actual type field

      const tradeDate = this.parseTradeDate(tradeDateString);

      if (tradeDate) {
        const typeStr = type ? type.toString() : '';
        this.events = [
          ...this.events,
          {
            start: tradeDate,
            title: `${typeStr.toUpperCase()} ${symbol}`,
            color: {
              primary: typeStr.toLowerCase() === 'buy' ? '#1e90ff' : '#ad2121', // blue for buy, red for sell
              secondary: '#FAE3E3'
            },
            allDay: true,
            meta: {
              position: row.position,
              symbol: row.symbol,
              type: row.type,
              volume: parseFloat(row.volume),
              openPrice: parseFloat(row.entry),
              stopLoss: parseFloat(row.sL),
              takeProfit: parseFloat(row.tP),
              closeTime: new Date(row.closeDate.replace(' ', 'T')),
              closePrice: parseFloat(row.exit),
              commission: parseFloat(row.commission),
              swap: parseFloat(row.swap),
              profit: parseFloat(row.profit),
            }
          }
        ];
      
      }
    });
  }

  getPnLColor(day: CalendarMonthViewDay): string {
    if (!day.events.length) return 'bg-white';
    const pnl = day.events.reduce((sum, e) => sum + (e.meta?.profit || 0), 0);
    if (pnl > 0) return 'bg-green-100';
    if (pnl < 0) return 'bg-red-100';
    return 'bg-gray-100';
  }

  countWins(events: any[]): number {
    return events.filter(event => event.meta?.profit > 0).length;
  }
  
  countLosses(events: any[]): number {
    return events.filter(event => event.meta?.profit < 0).length;
  }
  
  totalProfit(events: any[]): number {
    console.log(events);
    return events
      .filter(event => event.meta?.profit > 0)
      .reduce((sum, event) => sum + (event.meta?.profit || 0), 0)
      .toFixed(2);
  }
  
  totalLoss(events: any[]): number {
    return events
      .filter(event => event.meta?.profit < 0)
      .reduce((sum, event) => sum + (event.meta?.profit || 0), 0)
      .toFixed(2);
  }
  parseTradeDate(dateStr: string): Date | null {
    // MT5 format is like "2025.03.25 09:10:25"
    const parts = dateStr.split(' ');
    if (parts.length !== 2) return null;
  
    const dateParts = parts[0].split('.');
    const timeParts = parts[1].split(':');
  
    if (dateParts.length !== 3 || timeParts.length !== 3) return null;
  
    return new Date(
      parseInt(dateParts[0]),  // Year
      parseInt(dateParts[1]) - 1, // Month (0-based)
      parseInt(dateParts[2]),  // Day
      parseInt(timeParts[0]),  // Hours
      parseInt(timeParts[1]),  // Minutes
      parseInt(timeParts[2])   // Seconds
    );
  }

  onDayClicked(date: Date) {
    alert('Clicked: ' + date.toDateString());
  }

async onPaste(event: ClipboardEvent): Promise<void> {
    const clipboardItems = event.clipboardData?.items;
    if (clipboardItems) {
      for (let i = 0; i < clipboardItems.length; i++) {
        const item = clipboardItems[i];
        if (item.type === 'text/plain' || item.type === 'text/tab-separated-values') {
          const text = event.clipboardData?.getData('text/plain');
          if (text) {
            this.parseTableData(text);
          }
        }
      }
      //If you're refreshing data multiple times (e.g., after upload or load), don't unsubscribe and reuse the old Subject. Instead, recreate it:
      this.dtTrigger.unsubscribe();
      this.dtTrigger = new Subject();
      this.dtTrigger.next(null)
      console.log("printing to DT")
    }
  }

  parseTableData(data: string): void {
    // Example: Handle pasted tab-separated or comma-separated values (CSV)
    // const rows = data.split('\n').map(row => row.split('\t')); // For tab-separated values
    // Alternatively, for CSV: const rows = data.split('\n').map(row => row.split(','));
    const rows = data
    .split('\n')
    .map((row: string) => row.trim()) 
    .filter((row: string) => row.length > 0) // Remove empty lines
    .map((row: string) => {
      const cells = row.split('\t');
      
      // Add 5 hours to datetime strings at column 0 and 8
      [0, 8].forEach(index => {
        if (cells[index]) {
          const [datePart, timePart] = cells[index].split(' ');
          const [year, month, day] = datePart.split('.').map(Number);
          const [hour, minute, second] = timePart.split(':').map(Number);

          const dateObj = new Date(year, month - 1, day, hour, minute, second);
          dateObj.setHours(dateObj.getHours() + 5);

          const formattedDate = `${String(dateObj.getMonth() + 1).padStart(2, '0')}.${String(dateObj.getDate()).padStart(2, '0')}.${dateObj.getFullYear()} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
          cells[index] = formattedDate;
        }
      });

      // Define which columns should be numbers
      // Indices for: Volume, Price, S/L, T/P, Close Price, Commission, Swap, Profit
      const numberColumns = [4, 5, 6, 7, 9, 10, 11, 12]; 
      // Loop and convert specific columns
      numberColumns.forEach(index => {
        if (cells[index] !== undefined) {
          cells[index] = cells[index].replace(/\s+/g, ''); // Remove spaces & parse to number
        }
      });

      //add 13th column-Net Profit
      cells[13] = (parseFloat(cells[10]) + parseFloat(cells[12])).toFixed(2)

      // ✅ Insert null at position 1 and 2 (for displaying notion data later)
      cells.splice(1, 0, "");   // Insert at index 1
      cells.splice(2, 0, ""); // Insert at index 2 (after symbol)
      return cells;
    }); 

    console.log(rows)
    // this.tableData = rows;
    this.tableData = rows.map(row => ({
      openDate: row[0],
      tradeNotion: [],
      status: row[2],
      position: row[3],
      symbol: row[4],
      type: row[5],
      volume: row[6],
      entry: row[7],
      sL: row[8],
      tP: row[9],
      closeDate: row[10],
      exit: row[11],
      commission: row[12],
      swap: row[13],
      profit: row[14],
      netProfit: row[15],
      riskPerTrade:"0",
      rrr:"0",
      mt5status:"closed",
      mfe:"0" // Initialize MFE to 0 for imported trades
    } as Table)); //The 'as Table' makes sure it matches the interface
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];  // Get the selected file
    if (file) {
      this.readExcelFile(file);  // Parse the Excel file
    }
  }

    // This method reads the Excel file and converts it into a usable format
    readExcelFile(file: File): void {
      const reader = new FileReader();
  
      reader.onload = (e: any) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
  
        // Assume that the first sheet contains the data
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
  
        // Convert the sheet to a 2D array (array of rows and columns)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
        // Store the raw data for later reference
        this.rawData = jsonData;
  
        // Find the start and end rows based on the text in the first column
        const startRowIndex = this.findRowIndex('Positions')+1;
        const endRowIndex = this.findRowIndex('Orders')-1;
  
        // Slice the data between "Positions" and "Orders"
        if (startRowIndex !== -1 && endRowIndex !== -1 && endRowIndex > startRowIndex) {
          this.tableData = this.rawData.slice(startRowIndex, endRowIndex + 1); // Include "Orders" row
        } else {
          console.error('Start or end row not found');
        }
  
        // Optional: Show the result in the console for debugging
        console.log('Filtered data:', this.tableData);
      };
  
      // Read the file as an array buffer
      reader.readAsArrayBuffer(file);
    }

    // This method finds the row index of the first occurrence of the given text in the first column
  findRowIndex(searchText: string): number {
    for (let i = 0; i < this.rawData.length; i++) {
      if (this.rawData[i][0] && this.rawData[i][0].toString().toLowerCase() === searchText.toLowerCase()) {
        return i; // Return the index of the row where the text is found
      }
    }
    return -1; // Return -1 if the text is not found
  }

  // Optional: Implement file upload to a server or Firebase
onUpload(): void {
  console.log('Uploading data...', this.tableData);
  const collectionRef = collection(this.firestore, 'trades');

  this.showProgressBar = true;
  this.hideProgressBar = false;
  this.isUploading = true;
  this.uploadProgress = 0;

  const total = this.tableData.length;
  let uploaded = 0;

  this.tableData.forEach(async (row) => {
    try {
      const documentId = row.openDate;
      const docRef = doc(collectionRef, documentId);
      await setDoc(docRef, {
        rowData: row
      });
      uploaded++;
      this.uploadProgress = Math.round((uploaded / total) * 100);
    } catch (error) {
      console.error('Error uploading row: ', error);
    }

    if (uploaded === total) {
      setTimeout(() => {
        this.isUploading = false;
        this.hideProgressBar = true; // Triggers CSS fade-out
        this.showProgressBar = false;
        this.uploadProgress = 0;
      }, 2000); // Wait for CSS transition
    }
  });
}
  
  loadTradesRealtime() {
    const collectionRef = collection(this.firestore, 'trades');
    onSnapshot(collectionRef, (querySnapshot) => {
      const loadedData: any[] = [];

      querySnapshot.forEach((doc) => {
        loadedData.push({
          id: doc.id,
          ...doc.data()
        });
      });
      console.log('Real-time trades:', loadedData);
      this.tableData = loadedData;
    }, (error) => {
      console.warn('⚠️ Firestore realtime listener error - continuing in offline mode:', error.message);
      // Keep existing data, don't update
    });
  }

  loadTrades(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tradesRef = collection(this.firestore, 'trades');
      getDocs(tradesRef).then((querySnapshot) => {
        const firestoreTrades = querySnapshot.docs.map(doc => doc.data()['rowData']);
        console.log("��� Loaded from Firestore:", firestoreTrades.length, "trades");

        // Don't overwrite existing tableData, merge with MT5 trades
        if (this.mt5LiveTrades.length > 0) {
          console.log("🔴 Preserving existing MT5 trades:", this.mt5LiveTrades.length);
          // Keep MT5 trades and add Firestore trades
          this.tableData = [...this.mt5LiveTrades, ...firestoreTrades];
        } else {
          this.tableData = firestoreTrades;
        }

        console.log("📊 Final tableData after loadTrades:", this.tableData.length);
        resolve(); // Notify that loading is done
      }).catch((error) => {
        console.warn('���️ Firestore connection issue - operating in offline mode:', error.message);
        // Continue with existing data or empty array
        if (this.mt5LiveTrades && this.mt5LiveTrades.length > 0) {
          this.tableData = [...this.mt5LiveTrades];
          console.log("📊 Using MT5 data only:", this.tableData.length);
        } else {
          this.tableData = [];
        }
        resolve(); // Don't reject, just continue with available data
      });
    });
  }
  
  copyColumns(index1: number, index2: number): void {
    // const combinedValues = this.tableData.map(row => {
    //   return `${row[index1]}\t${row[index2]}`; // tab-separated
    // });
    // const textToCopy = combinedValues.join('\n');
    // navigator.clipboard.writeText(textToCopy).then(() => {
    //   alert('Two columns copied to clipboard!');
    // });
  }
  
isRowAlreadySelected(row: any): boolean {
  return row.tradeNotion.some((t: { tradeDate: any; }) => t.tradeDate);
}



  async getAllPagesFromDB(startDate:Date,endDate:Date){ 
    const formattedStartDate = startDate
      ? `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`
      : '';
    const formattedEndDate = endDate
      ? `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`
      : '';
    // this.isLoadingPatching = true;
    this.progressPatching = 0;

    const body = {
      "filter": {
        "and": [
          {
            "property": "Date",
            "date": {
              "on_or_after": formattedStartDate
            }
          },
          {
            "property": "Date",
            "date": {
              "on_or_before": formattedEndDate
            }
          }
        ]
      }
    }
    this.http.post("http://localhost:3000/api/getAllPagesFromDB", body)
    .subscribe({
      next: async (res:any) => {
        // console.log(res)
        this.trades = [];
        res.results.map((prop: any) => {
          const d = new Date(prop.properties.Date.date.start);
          const dayOfWeek = d.getDay();
          // Skip weekends (0 = Sunday, 6 = Saturday)
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            this.trades.push({ tradeDate: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`, 
            tradeId: prop.id });
          }
        });
        const total = this.trades.length;
        let completed = 0;

        for (const trade of this.trades) {
          // console.log("trade",trade)
          let relationId = this.relations.filter(rel => rel.relationName === trade.tradeDate)[0].relationId
          const body = {
            "payload": {
              "properties": {
                "Activity log": {
                  "relation": [
                    {
                      "id": relationId
                    }
                  ]
                }
              }
            },
            "url":trade.tradeId
          }
          try {
            const res: any = await firstValueFrom(
              this.http.patch("http://localhost:3000/api/patchRelationIdToTrade", body) //Patching
            );
            if (res) {
              console.log("Patching successful: "+trade.tradeDate)
            }else{
              console.log("Patching failed: "+trade.tradeDate)
            }
            completed++;
            this.progressPatching = Math.floor((completed / total) * 100);

          } catch (error) {
            this.patchingError = true
            console.error('Error patching:',trade, error);
          }
        }
        // this.isLoadingPatching = false; //hide the progress for checking and patching, which should be located at the end of the process
        // this.isLoadingChecking = false;
      },
      error: (err) => {
        this.patchingError = true
        console.error('Error:', err)
      }
    });
  }

  delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async checkAndCreateRelationId(){
    // if (!this.startDate || !this.endDate){  // Check if startDate or endDate is null{
    //   return
    // }
    this.isLoadingChecking = true;
    this.isLoadingPatching = true;
    this.isLoadingComparing = true;
    this.isLoadingPopulating = true;
    this.progressChecking = 0;
    this.progressPatching = 0;
    this.progressComparing = 0;
    this.progressPopulating = 0;
    const dateRange: string[] = [];

    //loop every trades in the table,format the date and save it to dateRange as MM-DD-YYYY
    for ( let i=0; i<= this.tableData.length-1; i++){
      let d = new Date(this.tableData[i].openDate ?? '');
      const dayOfWeek = d.getDay();
      // Skip weekends (0 = Sunday, 6 = Saturday)  Skip if date is weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const year = d.getFullYear();
        dateRange.push(`${month}-${day}-${year}`);
      }
    }
    const total = dateRange.length;
    let completed = 0;
    //loop every date in dateRange, check if relationName already exists in Notion, if not, create it
    //however, to speed up the loop process, if the previous date is already done checking and if date already exists in this.relations, continue already to the next date
    for (const date of dateRange) {
       // ✅ Skip if already exists 
        const alreadyProcessed = this.relations.some(rel => rel.relationName === date);
        if (alreadyProcessed  ) { 
          completed++;
          this.progressChecking = Math.floor((completed / total) * 100);
          continue; // Skip to next date
        }


       const body = {
          "filter": {
            "property": "Name",
            "title": {
              "equals": date
            }
          }
        }
        try {
          const res: any = await firstValueFrom(
            this.http.post("http://localhost:3000/api/getRelationName", body)
          );
          //To check if an object with the same relationName already exists in the this.relations array before pushing
          if (res.results.length > 0) {
            const exists = this.relations.some(
              rel => rel.relationName === date && rel.relationId === res.results[0].id
            );
            if (!exists) {
              this.relations.push({
                relationName: date,
                relationId: res.results[0].id
              });
            }
          } else {
            await this.createRelationId(date); // make this async if needed
          }
          console.log('done checking:', date);
          completed++;
          this.progressChecking = Math.floor((completed / total) * 100);
          
          // await this.delay(300); // optional
        } catch (error) {   
          this.checkingError = true      
          console.error('Error checking relation for', date, error);
        }
    }
    console.log('All dates checked');
   
    console.log(this.relations)
    const startDate = new Date(this.tableData[0].openDate ?? '')
    const endDate = new Date(this.tableData[this.tableData.length-1].openDate ?? '')
    this.getAllPagesFromDB(startDate,endDate) //ready for Patching.. relationIds to ActivityLog
  }

  async createRelationId(dateName:string): Promise<any>{
    const body = {
      "parent": {
        "database_id": "5e00bcb25c3d4276b1de54de3576894a"
      },
      "properties": {
        "Name": {
          "title": [
            {
              "text": {
                "content": dateName
              }
            }
          ]
        }
      }
    }
    const res: any = await firstValueFrom(
      this.http.post("http://localhost:3000/api/createRelationId", body)
    );
    if (res) {
      // this.relations = []
      this.relations.push({ relationName: dateName, relationId: res.id })
      console.log("created successful:"+dateName);
    } 

  }

    async createNewEntry(trade:Table): Promise<any>{
      const [month, day, yearAndTime] = trade.openDate.split(".");
      const [year, time] = yearAndTime.split(" ");
      const iso = `${time ? `${year}-${month}-${day}T${time}:00+08:00` : ""}`; //2025-07-04T15:37:00+08:00
    const body = {
        "parent": {
          "database_id": "ef10ac6f79524ea49e4bc0997e0ee704"
        },
        "properties": {
          "Date": {
            "date": {
              "start": iso, //2025-07-04T15:37:00+08:00
              "end": iso
            }
          },
          "Account": {  
            "multi_select": [
              { "name": "5ers4️⃣5k [#25475923]" }
            ]
          },
          "ticket":{
            "number": trade.position
          },
          "riskPerTrade":{
              "rich_text": [
                {
                  "text": {
                    "content": trade.riskPerTrade
                  }
                }
              ]
            },
          "sl":{
              "rich_text": [
                {
                  "text": {
                    "content": trade.sL
                  }
                }
              ]
            },
          "tp":{
            "rich_text": [
              {
                "text": {
                  "content": trade.tP
                }
              }
            ]
          },
          "Lots":{
            "rich_text": [
              {
                "text": {
                  "content": trade.volume
                }
              }
            ]
          },
          "price_open":{
            "rich_text": [
              {
                "text": {
                  "content": trade.entry
                }
              }
            ]
          },
          "Buy/Sell": {
            "select": {
              "name": parseInt(trade.type) === 0 ? 'Buy' : 'Sell'
            }
          }


        }
      }
    const res: any = await firstValueFrom(
      this.http.post("http://localhost:3000/api/createNewEntry", body)
    );
    // if (res) {
      
    // } 

  }


  async updateExistingEntry(trade:Table): Promise<any>{
    const body = { //get the page id of the existing entry
      "filter": {
        "property": "ticket",
        "number": {
          "equals": trade.position
        }
      }
    }
    try {
      const res: any = await firstValueFrom(
        this.http.post("http://localhost:3000/api/getAllPagesFromDB", body)
      );
      if (res.results.length > 0) {
        const pageId = res.results[0].id; // Get the first result's ID
        const [month, day, yearAndTime] = trade.closeDate.split(".");
        const [year, time] = yearAndTime.split(" ");
        const iso = `${time ? `${year}-${month}-${day}T${time}:00+08:00` : ""}`; //2025-07-04T15:37:00+08:00
        const body = {
          "payload": {
            "properties": {
              "Date": {
                "date": {
                  "start": res.results[0].properties.Date.date.start, // Keep the original start date
                  "end": iso
                }
              },
              "price_close": {
                 "rich_text": [
                  {
                    "text": {
                      "content": trade.exit ? trade.exit.toString() : "0"
                    }
                  }
                ]
              },
              "PnL": {
                "number": trade.profit ? parseFloat(trade.profit) : "" // Ensure profit is a number
              },
              "rrr":{
                "rich_text": [
                  {
                    "text": {
                      "content": trade.rrr ? trade.rrr.toString() : "0"
                    }
                  }
                ]
              },
              "mup":{
                "rich_text": [
                  {
                    "text": {
                      "content": trade.mfe ? trade.mfe.toString() : "0"
                    }
                  }
                ]
              }
            }
          },
          "url":pageId // Use the first tradeId from tradeNotion
        }

        try {
          const res: any = await firstValueFrom(
            this.http.patch("http://localhost:3000/api/updatePropertiesToTrade", body)
          );
          if (res) {
            console.log("Updated existing entry for ticket:", res);
          }
          
        } catch (error) {
          console.error('Error updating existing entry', error);
        }

      }

    } catch (error) {   
        console.log("No existing entry found for ticket:", trade.position);
    } 

  }

  async compareToNotion(){
    console.log('🔍 Starting Compare to Notion process...');
    //for progress bar comparing
    const total = this.tableData.length;
    let completed = 0;

    for (const row of this.tableData) {  //for every rows in table, get the notion trades page using OpenDate (as a uniqueID)
      const originalDateStr = row.openDate; // e.g. "07.04.2025 15:37"
      const [datePart, timePart] = originalDateStr.split(' ');
      const [month, day, year] = datePart.split('.').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);

      // Create the date in local time (assumes you are in GMT+8 like Philippines)
      const date = new Date(year, month - 1, day, hour, minute);
      const isoDate = this.formatToNotionDate(date,"yyyymmdd");;
      const body = {
        "filter": {
          "property": "Date",  // exact name of the Date property in Notion
          "date": {
            "equals": isoDate
          }
        }
      }

      try {
        const res: any = await firstValueFrom(
          this.http.post("http://localhost:3000/api/getAllPagesFromDB", body)
        );
        if (res.results && res.results.length > 0) {
          // console.log("Matched found: "+res.results[0].properties["Daily Reflection 📆"])
          // console.log("Matched found:",res.results[0].id)
          row.tradeNotion = [{tradeDate: "", tradeId: res.results[0].id}];
          row.status = "Matched"
          console.log('✅ Match found for', originalDateStr, '- Status:', row.status);
        }else{
          row.status = "Unmatched"
          // console.log('No Matched found for: '+isoDate, error);
            const tradesForUnmatched = await this.getTradesUnmatched(isoDate)
            row.tradeNotion = tradesForUnmatched.map((trade: Trades) =>
              trade
            );
            console.log('⚠️ No match for', originalDateStr, '- Found', tradesForUnmatched.length, 'unmatched trades');
        }
        completed++;
        this.progressComparing = Math.floor((completed / total) * 100);
      } catch (error) {
        this.comparingError = true
        console.error('Error comparing to Notion',row, error);
      }
    }

    console.log('��� Compare to Notion completed! Data updated in simple table.');

    // Simple change detection - no DataTable refresh needed!
    this.cdr.detectChanges();
  }

// Helper function to format the date; Manually format to ISO with +08:00 timezone
 formatToNotionDate(date: Date,dateFormat:String): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  
  return (dateFormat === "yyyymmdd")
  ? `${yyyy}-${mm}-${dd}T${hh}:${min}:00+08:00`
  : `${yyyy}-${dd}-${mm}T${hh}:${min}:00+08:00`;
}

  async getTradesUnmatched(isoDate:any): Promise<any>{
    console.log(isoDate)
    const targetTime = new Date(isoDate); //"2025-07-04T15:37:00+08:00"
    // Subtract 10 minutes
    const from = new Date(targetTime.getTime() - 10 * 60 * 1000);
    // Add 30 minutes
    const to = new Date(targetTime.getTime() + 30 * 60 * 1000);
    const fromISO = this.formatToNotionDate(from,"yyyymmdd");
    const toISO = this.formatToNotionDate(to,"yyyymmdd");
   
    const body = {
      "filter": {
        "and": [
          {
            "property": "Date",
            "date": {
              "on_or_after": fromISO
            }
          },
          {
            "property": "Date",
            "date": {
              "on_or_before": toISO
            }
          }
        ]
      }
    }
    const res: any = await firstValueFrom(
      this.http.post("http://localhost:3000/api/getAllPagesFromDB", body));

    const tradesFoundForUnmatched:Trades[] = []
     if (res.results && res.results.length > 0) {
        res.results.map((prop: any) => {
          const d = new Date(prop.properties.Date.date.start);
          const hh = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          tradesFoundForUnmatched.push({ tradeDate: `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.${d.getFullYear()} ${hh}:${min}`, 
          tradeId: prop.id })
        });
        console.log(tradesFoundForUnmatched)
      }else{
        console.log("Not tradesFoundForUnmatched.")
      }
      return tradesFoundForUnmatched
  }

chooseUnmatchedTrade(tradeNotion: Trades, row: Table, rowIndex: number) {
  if (this.selectedTradeId[rowIndex] === tradeNotion.tradeId) {
    // Already selected — unselect it
    this.selectedTradeId[rowIndex] = null;
    row.status = "Unmatched";
    localStorage.removeItem(rowIndex.toString());
  } else {
    // Select the trade
    this.selectedTradeId[rowIndex] = tradeNotion.tradeId;
    row.status = "Matched";

    // Store original array in case of revert
    localStorage.setItem(rowIndex.toString(), JSON.stringify(row.tradeNotion));
  }
}


  revertTradeNotion(row: Table, rowIndex: number) {
    // Revert the tradeNotion to an empty array
    row.tradeNotion = [];
    this.selectedTradeId[rowIndex] = null; // Reset the selected trade ID for this row
    row.status = "Unmatched"; // Set status back to unmatched
    row.tradeNotion = localStorage.getItem(rowIndex.toString()) ? JSON.parse(localStorage.getItem(rowIndex.toString()) || '[]') : [];
    localStorage.removeItem(rowIndex.toString()); // Clear local storage if needed
  }

  async populateData(){
    //for progress bar populating
    const total = this.tableData.length;
    let completed = 0;
    //returns true only if every object in the array meets the condition-for checking if all trades are Matched status
    const allMatched = this.tableData.every(item => item.status === 'Matched');
    const propFirmAccountValue = 5000; //change this in the future to read the excel file
    if (allMatched) {
      console.log('✅ All trades are matched.');
      for (const trade of this.tableData) {
          const percentPnLTemp = (parseFloat(trade.netProfit) / propFirmAccountValue) * 100; // Assuming 5000 is the base value for PnL percentage calculation
          const percentPnL = parseFloat(percentPnLTemp.toFixed(2)); // -0.23
          const body = {
            "payload": {
              "properties": {
                "PnL": {
                  "number": trade.netProfit ? parseFloat(trade.netProfit) : "" // Ensure netProfit is a number
                },
                "%PnL": {
                  "number": percentPnL
                }
              }
            },
            "url":trade.tradeNotion[0].tradeId // Use the first tradeId from tradeNotion
          }

          try {
            const res: any = await firstValueFrom(
              this.http.patch("http://localhost:3000/api/updatePropertiesToTrade", body)
            );
            if (res) {
              console.log("Updating successful: ",res)
            }
            completed++;
            this.progressPopulating = Math.floor((completed / total) * 100);
          } catch (error) {
            this.populatingError = true
            console.error('Error populating data for', error);
          }
      }

    } else {
      console.log('❌ Some trades are still unmatched.');
    }
  }

  async getMt5API(){
    const res: any = await firstValueFrom(
      this.http.get("http://localhost:5000/api/history")
    );
    console.warn(res)
    return res;
  }

  async sendNotif(token: string, title: string, body: string): Promise<void> {
    try {
      const token = localStorage.getItem('fcm_token');
      if (!token) {
        console.warn('⚠️ No FCM token available for notification');
        return;
      }

      const payload = {
        "token": token,
        "title": title,
        "body": body,
      };

      const res: any = await firstValueFrom(
        this.http.post("http://localhost:3000/api/sendNotif", payload)
      );

      if (res) {
        console.log('✅ News reminder notification sent:', title);
      }
    } catch (error) {
      console.error('��� Error sending notification:', error);
    }
  }

  async loadNotionPerformanceData(): Promise<void> {
    this.isLoadingNotionData = true;
    console.log('🔄 Starting to load ALL Notion performance data with pagination...');

    try {
      // Check if backend is running first
      console.log('��� Checking backend availability...');

      const backendRunning = await this.isBackendRunning();

      if (!backendRunning) {
        console.warn('⚠️ Backend is not running or not accessible');
        this.notionPerformanceData = [];
        return;
      }

      // Collect all results using pagination
      let allResults: any[] = [];
      let hasMore = true;
      let startCursor: string | null = null;
      let pageCount = 0;

      console.log('📤 Starting pagination to get ALL entries from your Notion database...');
      // console.log('📤 Database ID: ef10ac6f79524ea49e4bc0997e0ee704');

      while (hasMore) {
        pageCount++;

        // Build request body for pagination
        const body: any = {};
        if (startCursor) {
          body.start_cursor = startCursor;
        }

        console.log(`���� Fetching page ${pageCount}...`, startCursor ? `(cursor: ${startCursor.substring(0, 20)}...)` : '(first page)');

        // Use the proxy endpoint that matches your database ID exactly
        const proxyResponse: any = await firstValueFrom(
          this.http.post("http://localhost:3000/api/getAllPagesFromDB", body)
        );

        console.log(`📥 Page ${pageCount} response:`, {
          results_count: proxyResponse?.results?.length || 0,
          has_more: proxyResponse?.has_more,
          next_cursor: proxyResponse?.next_cursor ? `${proxyResponse.next_cursor.substring(0, 20)}...` : null
        });

        if (proxyResponse && proxyResponse.results && proxyResponse.results.length > 0) {
          // Add results from this page to our collection
          allResults = allResults.concat(proxyResponse.results);
          console.log(`✅ Page ${pageCount}: Added ${proxyResponse.results.length} entries. Total so far: ${allResults.length}`);

          // Check if there are more pages
          hasMore = proxyResponse.has_more === true;
          startCursor = proxyResponse.next_cursor || null;

          if (hasMore && startCursor) {
            console.log(`🔄 More data available, fetching next page...`);
          } else {
            console.log(`🏁 Reached end of data. has_more: ${hasMore}, next_cursor: ${startCursor}`);
          }
        } else {
          console.log(`📭 Page ${pageCount}: No results found, ending pagination`);
          hasMore = false;
        }

        // Safety check to prevent infinite loops
        if (pageCount > 50) {
          console.warn('⚠️ Stopped pagination after 50 pages to prevent infinite loop');
          break;
        }
      }

      console.log(`���� Pagination complete! Retrieved ${allResults.length} total entries from ${pageCount} pages`);

      if (allResults.length > 0) {
        // Show first page structure for debugging
        console.log('��� First entry structure:', allResults[0]);
        console.log('📝 Properties available:', Object.keys(allResults[0].properties || {}));

        this.notionPerformanceData = this.parseNotionResponse(allResults);
        console.log('✅ Your complete Notion data loaded and parsed:', this.notionPerformanceData.length, 'records');
        console.log('✅ Sample parsed record:', this.notionPerformanceData[0]);
  
      } else {
        console.warn('⚠️ No results found in your Notion database after pagination');
        this.notionPerformanceData = [];
   
      }

      // Trigger DataTable rendering safely
      this.triggerDataTableRender();

    } catch (error: any) {
      console.error('❌ Error during paginated loading of your Notion data:');
      console.error('Full error object:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error status:', error.status);

      if (error.status === 0) {
        console.error('🔌 Connection failed - backend server may not be running');
      }

      // Show empty state instead of mock data
      this.notionPerformanceData = [];
   

      // Still trigger DataTable rendering safely
      this.triggerDataTableRender();

    } finally {
      this.isLoadingNotionData = false;
    console.log('🏁 Finished loading your complete Notion data');
    }
  }

  // Refresh chart with beautiful animation
  refreshChart(): void {
    const refreshBtn = document.querySelector('.chart-refresh-btn');
    if (refreshBtn) {
      refreshBtn.classList.add('spinning');
      setTimeout(() => {
        refreshBtn.classList.remove('spinning');
      }, 1000);
    }
    this.generateTradingChartData();
  }

  // Generate stunning chart data with realistic trading patterns
  generateTradingChartData(): void {
    console.log('🎨 Generating beautiful trading chart data...');

    const startingBalance = this.mt5AccountInfo?.startingBalance ?? 0;
    let currentBalance = startingBalance;
    let cumulativePnL = 0;
    let peakBalance = startingBalance;

    const labels: string[] = [];
    const balanceData: number[] = [];
    const pnlData: number[] = [];
    const drawdownData: number[] = [];

    // Sort trades by date for proper chart progression
    const sortedTrades = [...this.tableData].sort((a, b) => {
      const dateA = new Date(a.openDate || '');
      const dateB = new Date(b.openDate || '');
      return dateA.getTime() - dateB.getTime();
    });

    // Add starting point
    labels.push('Start');
    balanceData.push(startingBalance ?? 0);
    pnlData.push(0);
    drawdownData.push(0);

    // Process each trade for chart progression
    sortedTrades.forEach((trade, index) => {
      const tradeProfit = parseFloat(trade.netProfit || '0');
      currentBalance += tradeProfit;
      cumulativePnL += tradeProfit;

      // Update peak for drawdown calculation
      if (currentBalance > peakBalance) {
        peakBalance = currentBalance;
      }

      // Calculate drawdown percentage
      const drawdown = ((peakBalance - currentBalance) / peakBalance) * 100;

      // Format date for label
      const tradeDate = new Date(trade.openDate || '');
      const dateLabel = tradeDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });

      labels.push(`${dateLabel} #${index + 1}`);
      balanceData.push(currentBalance);
      pnlData.push(cumulativePnL);
      drawdownData.push(drawdown);
    });

    // If no trades, show empty chart with starting balance and reference lines
    if (sortedTrades.length === 0) {
      console.log('📊 No trade data found, showing empty chart...');
      const currentTotalPnL = this.calculateTotalPnL();
      const pnlLineValue = startingBalance + currentTotalPnL;
      const accountSize = this.calculateAccountSize();

      this.chartData = {
        labels: ['Start'],
        datasets: [
          {
            label: 'Account Balance',
            data: [startingBalance],
            borderColor: 'rgb(16, 185, 129)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 4,
            fill: true,
            tension: 0.3,
            pointBackgroundColor: 'rgb(16, 185, 129)', // Green starting point
            pointBorderColor: '#ffffff',
            pointBorderWidth: 3,
            pointRadius: 8,
            pointHoverRadius: 12
          },
          {
            label: '🟠 --- Current P&L',
            data: [pnlLineValue],
            borderColor: '#7c3aed',
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderDash: [8, 4],
            fill: false,
            tension: 0,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointBackgroundColor: 'transparent',
            pointBorderColor: 'transparent'
          },
          {
            label: `🎯 Profit Target (${this.mt5AccountInfo.profitTarget}%)`,
            data: [startingBalance * (1 + this.mt5AccountInfo.profitTarget / 100)],
            borderColor: 'rgb(16, 185, 129)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 4,
            borderDash: [12, 8],
            fill: false,
            tension: 0,
            pointRadius: 6,
            pointHoverRadius: 10,
            pointBackgroundColor: 'rgb(16, 185, 129)',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 3,
            pointStyle: 'triangle',
            shadowOffsetX: 0,
            shadowOffsetY: 2,
            shadowBlur: 8,
            shadowColor: 'rgba(16, 185, 129, 0.3)'
          },
          {
            label: '🟣 --- Starting Balance',
            data: [accountSize],
            borderColor: '#3d3aed',
            backgroundColor: 'transparent',
            borderWidth: 1,
            fill: false,
            tension: 0,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointBackgroundColor: 'transparent',
            pointBorderColor: 'transparent'
          },
          {
            label: `⚠️ Max Drawdown (${this.mt5AccountInfo.maxTotalDrawdown}%)`,
            data: [startingBalance * (1 - this.mt5AccountInfo.maxTotalDrawdown / 100)],
            borderColor: 'rgb(239, 68, 68)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderWidth: 4,
            borderDash: [8, 6],
            fill: false,
            tension: 0,
            pointRadius: 6,
            pointHoverRadius: 10,
            pointBackgroundColor: 'rgb(239, 68, 68)',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 3,
            pointStyle: 'rect',
            shadowOffsetX: 0,
            shadowOffsetY: 2,
            shadowBlur: 8,
            shadowColor: 'rgba(239, 68, 68, 0.3)'
          }
        ]
      };
      return;
    }

    // Calculate current total P&L for horizontal reference line
    const currentTotalPnL = this.calculateTotalPnL();
    const pnlLineValue = startingBalance + currentTotalPnL;

    // Calculate highest balance reached
    const highestBalance = Math.max(...balanceData);

    // Get account size for purple reference line
    const accountSize = this.calculateAccountSize();

    // Chart with trading data progression and reference lines
    this.chartData = {
      labels: labels,
      datasets: [
        {
          label: 'Account Balance',
          data: balanceData,
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: (ctx: any) => {
            const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 400);
            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
            gradient.addColorStop(1, 'rgba(16, 185, 129, 0.05)');
            return gradient;
          },
          borderWidth: 4,
          fill: true,
          tension: 0.3,
          pointBackgroundColor: balanceData.map((val, i, arr) => {
            if (i === 0) return 'rgb(16, 185, 129)'; // Starting point - green (no blue)
            const profit = val - arr[i-1];
            return profit >= 0 ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)'; // Green for profit, red for loss
          }),
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: balanceData.map((_, i, arr) => {
            if (i === 0 || i === arr.length - 1) return 8; // Larger points for start/end
            return 6;
          }),
          pointHoverRadius: 12
        },
        {
          label: '🟠 --- Current P&L',
          data: new Array(labels.length).fill(pnlLineValue),
          borderColor: '#7c3aed',
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderDash: [8, 4],
          fill: false,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          pointBackgroundColor: 'transparent',
          pointBorderColor: 'transparent'
        },
        {
          label: `🎯 Profit Target (${this.mt5AccountInfo.profitTarget}%)`,
          data: new Array(labels.length).fill(startingBalance * (1 + this.mt5AccountInfo.profitTarget / 100)),
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'rgba(16, 185, 129, 0.05)',
          borderWidth: 4,
          borderDash: [12, 8],
          fill: '+1',
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 8,
          pointBackgroundColor: 'rgb(16, 185, 129)',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          shadowOffsetX: 0,
          shadowOffsetY: 2,
          shadowBlur: 12,
          shadowColor: 'rgba(16, 185, 129, 0.4)'
        },
        {
          label: '🟣 --- Starting Balance',
          data: new Array(labels.length).fill(accountSize),
          borderColor: '#3d3aed',
          backgroundColor: 'transparent',
          borderWidth: 1,
          fill: false,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          pointBackgroundColor: 'transparent',
          pointBorderColor: 'transparent'
        },
        {
          label: `⚠️ Max Drawdown (${this.mt5AccountInfo.maxTotalDrawdown}%)`,
          data: new Array(labels.length).fill(startingBalance * (1 - this.mt5AccountInfo.maxTotalDrawdown / 100)),
          borderColor: 'rgb(239, 68, 68)',
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          borderWidth: 4,
          borderDash: [8, 6],
          fill: '-1',
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 8,
          pointBackgroundColor: 'rgb(239, 68, 68)',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          shadowOffsetX: 0,
          shadowOffsetY: 2,
          shadowBlur: 12,
          shadowColor: 'rgba(239, 68, 68, 0.4)'
        }
      ]
    };

    console.log('✨ Beautiful trading chart generated with', labels.length, 'data points!');

    // Trigger chart update with animation
    if (this.chart) {
      this.chart.update('active');
    }
  }


  private parseNotionResponse(results: any[]): NotionPerformanceData[] {
    console.log('🔄 Parsing your Notion response. Results count:', results?.length || 0);

    if (!Array.isArray(results)) {
      console.error('❌ Results is not an array:', results);
      return [];
    }

    if (results.length === 0) {
      console.log('��� No pages found in your Notion database');
      return [];
    }

    // First, let's see what properties you actually have in your database
    const firstPage = results[0];
    if (firstPage && firstPage.properties) {
      console.log('�� Your Notion database properties:', Object.keys(firstPage.properties));

      // Show the structure of each property type
      Object.keys(firstPage.properties).forEach(key => {
        const prop = firstPage.properties[key];
        console.log(`   - ${key}: ${prop.type}`, prop);
      });
    }

    return results.map((page, index) => {
      try {
        const properties = page.properties;
        if (!properties) {
          console.warn(`⚠️ Page ${index + 1} has no properties`);
          return null;
        }

        // Extract data based on your exact Notion database properties
        const parsedData: NotionPerformanceData = {
          id: page.id || `page-${index}`,

          // Extract each property exactly as it appears in your database
          action: this.getNotionProperty(properties, 'Action', 'title') || '',
          date: this.getNotionProperty(properties, 'Date', 'date') || '',
          idealRRR: this.getNotionProperty(properties, 'Ideal RRR', 'select') || '',
          buySell: this.getNotionProperty(properties, 'Buy/Sell', 'select') || '',
          modelCheck: this.getNotionProperty(properties, 'Model✔', 'multi_select') || [],
          status: this.getNotionProperty(properties, 'Status', 'status') || '',
          percentPnL: this.getNotionProperty(properties, '%PnL', 'number') || 0,
          weeklyRetrospective: this.getNotionProperty(properties, 'Weekly Retrospective', 'rich_text') || '',
          account: this.getNotionProperty(properties, 'Account', 'multi_select') || [],
          strategy: this.getNotionProperty(properties, 'Strategy', 'select') || '',
          oneToOneReversal: this.getNotionProperty(properties, '1:1 Reversal', 'checkbox') || false,
          screenshots: this.getNotionProperty(properties, 'Screenshots', 'files') || [],
          modelForm: this.getNotionProperty(properties, 'Model form', 'multi_select') || [],
          idealSL: this.getNotionProperty(properties, 'Ideal SL', 'select') || '',
          reviewed: this.getNotionProperty(properties, 'Reviewed', 'checkbox') || false,
          uniqueID: this.getNotionProperty(properties, 'ID', 'unique_id') || 0,
          commission: this.getNotionProperty(properties, 'Commission', 'number') || 0,
          outcome: this.getNotionProperty(properties, 'Outcome', 'files') || [],
          held: this.getNotionProperty(properties, 'Held🕕', 'formula') || '',
          instrument: this.getNotionProperty(properties, 'Instrument', 'select') || '',
          pnl: this.getNotionProperty(properties, 'PnL', 'number') || 0,
          percentPnLCalc: this.getNotionProperty(properties, '%PnL-Calc', 'formula') || '',
          dailyReflection: this.getNotionProperty(properties, 'Daily Reflection ', 'rich_text') || '',
          lots: this.getNotionProperty(properties, 'Lots', 'number') || 0,
          divergenceValue: this.getNotionProperty(properties, 'Divergence value', 'number') || 0,
          pips: this.getNotionProperty(properties, 'Pips', 'number') || 0,
          formula: this.getNotionProperty(properties, 'Formula', 'formula') || 0,
          rulesViolated: this.getNotionProperty(properties, 'Rules violated 🛑', 'multi_select') || [],
          emptySelect: this.getNotionProperty(properties, '', 'select') || '',
          swap: this.getNotionProperty(properties, 'swap', 'number') || 0
        };

        // console.log(`✅ Parsed your data page ${index + 1}:`, parsedData);
        return parsedData;

      } catch (error) {
        console.error(`❌ Error parsing page ${index + 1}:`, error);
        return null;
      }
    }).filter(item => item !== null) as NotionPerformanceData[];
  }

  private getNotionProperty(properties: any, propertyName: string, type: string): any {
    try {
      const property = properties[propertyName];
      if (!property) {
        console.log(`🔍 Property "${propertyName}" not found. Available properties:`, Object.keys(properties));
        return null;
      }

      // console.log(`📋 Getting property "${propertyName}" of type "${type}":`, property);

      switch (type) {
        case 'select':
          return property.select?.name || '';

        case 'multi_select':
          if (Array.isArray(property.multi_select)) {
            return property.multi_select.map((item: any) => item.name || '');
          }
          return [];

        case 'status':
          return property.status?.name || '';

        case 'date':
          return property.date?.start || '';

        case 'number':
          return property.number !== undefined ? property.number : 0;

        case 'rich_text':
          if (Array.isArray(property.rich_text)) {
            return property.rich_text.map((text: any) => text.plain_text || '').join('') || '';
          }
          return '';

        case 'title':
          if (Array.isArray(property.title)) {
            return property.title.map((text: any) => text.plain_text || '').join('') || '';
          }
          return '';

        case 'checkbox':
          return property.checkbox === true;

        case 'unique_id':
          return property.unique_id?.number || 0;

        case 'formula':
          if (property.formula?.type === 'string') {
            return property.formula.string || '';
          } else if (property.formula?.type === 'number') {
            return property.formula.number || 0;
          }
          return property.formula?.string || property.formula?.number || '';

        case 'files':
          if (Array.isArray(property.files)) {
            return property.files.map((file: any) => file.name || '');
          }
          return [];

        case 'relation':
          if (Array.isArray(property.relation)) {
            return property.relation.map((rel: any) => rel.id || '');
          }
          return [];

        default:
          console.warn(`⚠️ Unknown property type: ${type} for property: ${propertyName}`);
          return null;
      }
    } catch (error) {
      console.error(`❌ Error getting property "${propertyName}":`, error);
      return null;
    }
  }

  refreshNotionData(): void {
    this.loadNotionPerformanceData();
  }

  loadNotionDataWithButton(): void {
    this.showLoadButton = false; // Hide the load button
    this.loadNotionPerformanceData(); // Load the data
  }

  toggleColumnVisibility(columnKey: string): void {
    // Prevent rapid toggles that could cause issues
    if (this.isRefreshingTable) {
      console.warn('Table is currently refreshing, please wait...');
      return;
    }

    this.columnVisibility[columnKey as keyof typeof this.columnVisibility] = !this.columnVisibility[columnKey as keyof typeof this.columnVisibility];

    // Update available columns array
    const column = this.availableColumns.find(col => col.key === columnKey);
    if (column) {
      column.visible = this.columnVisibility[columnKey as keyof typeof this.columnVisibility];
    }

    // Safely refresh DataTable
    this.safelyRefreshDataTable();
  }

  toggleColumnSelector(): void {
    this.showColumnSelector = !this.showColumnSelector;
  }

  getVisibleColumns(): any[] {
    return this.availableColumns.filter(col => col.visible);
  }

  hideAllColumns(): void {
    Object.keys(this.columnVisibility).forEach(key => {
      this.columnVisibility[key as keyof typeof this.columnVisibility] = false;
      const column = this.availableColumns.find(col => col.key === key);
      if (column) column.visible = false;
    });
    this.safelyRefreshDataTable();
  }

  showAllColumns(): void {
    Object.keys(this.columnVisibility).forEach(key => {
      this.columnVisibility[key as keyof typeof this.columnVisibility] = true;
      const column = this.availableColumns.find(col => col.key === key);
      if (column) column.visible = true;
    });
    this.safelyRefreshDataTable();
  }

  showDefaultColumns(): void {
    // Reset to default visibility
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

    // Update available columns
    this.availableColumns.forEach(col => {
      col.visible = this.columnVisibility[col.key as keyof typeof this.columnVisibility];
    });

    this.safelyRefreshDataTable();
  }

  private safelyRefreshDataTable(): void {
    if (this.isRefreshingTable) {
      return; // Prevent multiple simultaneous refreshes
    }

    this.isRefreshingTable = true;

    try {
      // Check if the table element exists
      const tableElement = document.getElementById('notionTable');
      if (!tableElement) {
        console.warn('Table element not found, skipping DataTable refresh');
        this.isRefreshingTable = false;
        return;
      }

      // Check if DataTable is initialized and destroy it safely
      if ($.fn.dataTable.isDataTable('#notionTable')) {
        const table = $('#notionTable').DataTable();
        if (table && typeof table.destroy === 'function') {
          table.destroy(true); // true = remove from DOM completely
        }
      }

      // Clear any existing DataTable data
      $('#notionTable').empty();

      // Wait for DOM cleanup, then reinitialize
      setTimeout(() => {
        try {
          // Double-check the element still exists after timeout
          const tableElementAfter = document.getElementById('notionTable');
          if (tableElementAfter) {
            this.dtTriggerNotion.next(null);
          }
        } finally {
          this.isRefreshingTable = false;
        }
      }, 200);

    } catch (error) {
      console.error('Error refreshing DataTable:', error);
      // Fallback: just trigger re-render without destroying
      setTimeout(() => {
        try {
          this.dtTriggerNotion.next(null);
        } finally {
          this.isRefreshingTable = false;
        }
      }, 100);
    }
  }

  async isBackendRunning(): Promise<boolean> {
    try {
      // Try a simple POST request to see if backend endpoint is responding
      console.log('��� Quick check if backend is responding...');

      const quickTestBody = {}; // Empty body as per your specification

      await firstValueFrom(
        this.http.post('http://localhost:3000/api/getAllPagesFromDB', quickTestBody, {
          headers: { 'Cache-Control': 'no-cache' }
        })
      );

      console.log('✅ Backend is responding to POST requests with empty body');
      return true;

    } catch (error: any) {
      console.log('⚠️ Backend quick check failed:', error.status || 'Connection error');

      // If it's a 404 with GET, but we're using POST now, so any response means server is up
      if (error.status === 404) {
        console.log('❌ Backend endpoint not found');
        return false;
      }

      // If it's any other error but not connection error, server might be running
      if (error.status && error.status !== 0) {
        console.log('��️ Backend is running but has issues with the API');
        return true; // Server is running, just has issues
      }

      return false;
    }
  }

  checkBackendInstructions(): void {
    const instructions = `
        🔧 How to start the Notion backend server:

        1. Open a new terminal window/tab
        2. Navigate to the backend directory:
          cd NotionProxyApi

        3. Install dependencies (if first time):
          npm install

        4. Start the development server:
          npm run dev

        5. You should see this message:
          "✅ Server running at http://localhost:3000"

        6. Then click "Test Backend" to verify the connection

        📁 Project Structure:
        - Your project has both frontend (trading-dashboard) and backend (NotionProxyApi)
        - The backend serves as a proxy to your Notion database
        - The frontend connects to localhost:3000 to get your Notion data

        💡 Troubleshooting:
        - Make sure you're in the NotionProxyApi folder when running npm run dev
        - Check that port 3000 is not already in use
        - Verify your Notion API token is configured in the backend
        `;

    alert(instructions);
  }

  async testBackendConnection(): Promise<boolean> {
    console.log('🔍 Testing backend connection...');
    console.log('Backend URL:', this.BACKEND_URL);

    try {
      console.log('Testing POST request to /api/getAllPagesFromDB with empty body...');

      // Use the exact API request format you provided - empty JSON object
      const testBody = {}; // Empty body as per your sample request

      const testResponse = await firstValueFrom(
        this.http.post(`${this.BACKEND_URL}/api/getAllPagesFromDB`, testBody)
      );

      console.log('✅ Backend POST request successful:', testResponse);

      // Check if we got actual data
      if (testResponse && (testResponse as any).results) {
        const resultCount = (testResponse as any).results.length;
        alert(`✅ Backend connection successful!\n\nYour Notion proxy server is running and found ${resultCount} pages in your database.\n\nDatabase ID: ef10ac6f79524ea49e4bc0997e0ee704`);
      } else {
        alert('��� Backend connection successful!\n\nYour Notion proxy server is running, but no data was returned. Check your Notion database configuration.');
      }

      return true;

    } catch (error: any) {
      console.error('❌ Backend connection test failed:');
      console.error('- Error object:', error);
      console.error('- Error name:', error.name);
      console.error('- Error message:', error.message);
      console.error('- Error status:', error.status);
      console.error('- Error statusText:', error.statusText);
      console.error('- Error url:', error.url);

      if (error.error) {
        console.error('- Error response body:', error.error);
      }

      // Provide detailed error message based on status
      let errorMessage = '❌ Backend connection failed!\n\n';

      if (error.status === 0 || error.status === undefined) {
        errorMessage += '���� Connection Error: Cannot reach the server\n\n';
        errorMessage += 'The backend server is not running.\n\n';
        errorMessage += 'To start the backend server:\n';
        errorMessage += '1. Open a new terminal window\n';
        errorMessage += '2. Navigate to: cd NotionProxyApi\n';
        errorMessage += '3. Run: npm run dev\n\n';
        errorMessage += 'You should see: "✅ Server running at http://localhost:3000"';
      } else if (error.status === 404) {
        errorMessage += '���� API Endpoint Not Found\n\n';
        errorMessage += 'The server is running but the API route is missing.\n';
        errorMessage += 'Make sure your backend server.js has the /api/getAllPagesFromDB endpoint defined.';
      } else if (error.status === 401 || error.status === 403) {
        errorMessage += '���� Authentication Error\n\n';
        errorMessage += 'The Notion API token might be invalid or missing.\n';
        errorMessage += 'Check your Notion API token in the backend configuration.';
      } else if (error.status >= 500) {
        errorMessage += '💥 Server Error\n\n';
        errorMessage += `Status: ${error.status}\n`;
        errorMessage += `Message: ${error.message}\n\n`;
        errorMessage += 'The server encountered an internal error.\n';
        errorMessage += 'Check the backend server console for detailed error messages.';
      } else {
        errorMessage += `🚨 HTTP Error: ${error.status}\n\n`;
        errorMessage += `Message: ${error.message}\n`;
        errorMessage += `URL: ${error.url}\n\n`;
        errorMessage += 'Check the backend server logs for more details.';
      }

      alert(errorMessage);
      return false;
    }
  }



  formatNotionDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (error) {
      return dateStr;
    }
  }

  getEmotionClass(emotion: string): string {
    const emotionLower = emotion?.toLowerCase() || '';
    if (emotionLower.includes('confident') || emotionLower.includes('disciplined')) return 'emotion-positive';
    if (emotionLower.includes('frustrated') || emotionLower.includes('angry')) return 'emotion-negative';
    if (emotionLower.includes('nervous') || emotionLower.includes('anxious')) return 'emotion-warning';
    return 'emotion-neutral';
  }
  // Trading Metrics Calculation Methods
  calculateTotalPnL(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    return this.tableData.reduce((total, trade) => {
      const netProfit = parseFloat(trade.netProfit) || 0;
      return total + netProfit;
    }, 0);
  }

  calculateDaysSinceFirstTrade(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;

    // Find the earliest trade date
    const earliestDate = this.tableData.reduce((earliest, trade) => {
      const tradeDate = new Date(trade.openDate || '');
      if (!earliest || tradeDate < earliest) {
        return tradeDate;
      }
      return earliest;
    }, null as Date | null);

    if (!earliestDate || isNaN(earliestDate.getTime())) return 0;

    // Calculate days between first trade and now
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - earliestDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  }

  calculateTotalPercentageGain(): number {
    const totalPnL = this.calculateTotalPnL();
    const startingBalance = this.mt5AccountInfo?.startingBalance

    if (startingBalance === undefined || startingBalance <= 0) return 0;

    const percentage = (totalPnL / startingBalance) * 100;
    return parseFloat(percentage.toFixed(2));
  }

  calculatePnLChangePercent(): string {
    // This would typically compare against previous period
    // For now, we'll return a placeholder
    return '0.00';
  }

  // Removed duplicate methods - keeping the newer implementations above

  getWinPercentageForGradient(): number {
    const total = this.getTotalTrades();
    if (total === 0) return 0;
    return (this.getWinCount() / total) * 100;
  }

  getBreakevenPercentageForGradient(): number {
    const total = this.getTotalTrades();
    if (total === 0) return 0;
    return (this.getBreakevenCount() / total) * 100;
  }

  getLossPercentageForGradient(): number {
    const total = this.getTotalTrades();
    if (total === 0) return 0;
    return (this.getLossCount() / total) * 100;
  }

  calculateAccountSize(): number {
    const balanceFromMt5 = this.mt5AccountInfo?.balance ?? 0;
    const totalPnL = this.calculateTotalPnL();
    return balanceFromMt5 - totalPnL;
  }

  calculateAvgTradeDuration(): string {
    if (!this.tableData || this.tableData.length === 0) return '0min';

    let totalMinutes = 0;
    let validTrades = 0;

    this.tableData.forEach(trade => {
      // Only calculate for closed trades (not live trades with '-' or empty close dates)
      if (trade.openDate && trade.closeDate &&
          trade.closeDate !== '-' &&
          trade.closeDate !== '' &&
          trade.closeDate.trim() !== '') {

        // Use the existing calculateHoldTime function logic
        const holdTimeStr = this.calculateHoldTime(trade.openDate, trade.closeDate);

        if (holdTimeStr && holdTimeStr !== '') {
          // Parse the hold time string to extract minutes
          const minutes = this.parseHoldTimeToMinutes(holdTimeStr);
          if (minutes > 0) {
            totalMinutes += minutes;
            validTrades++;
          }
        }
      }
    });

    if (validTrades === 0) return 'No data';

    const avgMinutes = Math.floor(totalMinutes / validTrades);
    const hours = Math.floor(avgMinutes / 60);
    const remainingMinutes = avgMinutes % 60;

    // Format like the existing calculateHoldTime function
    if (hours > 0 && remainingMinutes > 0) {
      return `${hours}hrs ${remainingMinutes}min`;
    } else if (hours > 0) {
      return `${hours}hrs`;
    } else if (avgMinutes > 0) {
      return `${avgMinutes}min`;
    } else {
      return '<1min';
    }
  }

  private parseHoldTimeToMinutes(holdTimeStr: string): number {
    if (!holdTimeStr || holdTimeStr === '<1min') return 0;

    let totalMinutes = 0;

    // Extract hours
    const hoursMatch = holdTimeStr.match(/(\d+)hrs/);
    if (hoursMatch) {
      totalMinutes += parseInt(hoursMatch[1]) * 60;
    }

    // Extract minutes
    const minutesMatch = holdTimeStr.match(/(\d+)min/);
    if (minutesMatch) {
      totalMinutes += parseInt(minutesMatch[1]);
    }

    return totalMinutes;
  }

  // Removed duplicate getTotalTrades - keeping the newer implementation above

  calculateAvgWin(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    const winningTrades = this.tableData.filter(trade => {
      const netProfit = parseFloat(trade.netProfit) || 0;
      return netProfit > 0;
    });

    if (winningTrades.length === 0) return 0;

    const totalWinnings = winningTrades.reduce((total, trade) => {
      return total + (parseFloat(trade.netProfit) || 0);
    }, 0);

    return totalWinnings / winningTrades.length;
  }

  calculateAvgLoss(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    const losingTrades = this.tableData.filter(trade => {
      const netProfit = parseFloat(trade.netProfit) || 0;
      return netProfit < 0;
    });

    if (losingTrades.length === 0) return 0;

    const totalLosses = losingTrades.reduce((total, trade) => {
      return total + (parseFloat(trade.netProfit) || 0);
    }, 0);

    return totalLosses / losingTrades.length;
  }

  calculateAvgWinPercentage(): number {
    const avgWin = this.calculateAvgWin();
    const accountSize = this.mt5AccountInfo?.startingBalance || this.calculateAccountSize() || 5000;

    if (avgWin <= 0 || accountSize <= 0) return 0;

    return (avgWin / accountSize) * 100;
  }

  calculateAvgLossPercentage(): number {
    const avgLoss = Math.abs(this.calculateAvgLoss());
    const accountSize = this.mt5AccountInfo?.startingBalance || this.calculateAccountSize() || 5000;

    if (avgLoss <= 0 || accountSize <= 0) return 0;

    return (avgLoss / accountSize) * 100;
  }

  calculateExpectancy(): number {
    const totalTrades = this.getTotalTrades();
    if (totalTrades === 0) return 0;

    const winRate = this.calculateWinRate() / 100;
    const avgWin = this.calculateAvgWin();
    const avgLoss = Math.abs(this.calculateAvgLoss());

    return (winRate * avgWin) - ((1 - winRate) * avgLoss);
  }

  calculateProfitFactor(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;

    const grossProfit = this.tableData
      .filter(trade => (parseFloat(trade.netProfit) || 0) > 0)
      .reduce((total, trade) => total + (parseFloat(trade.netProfit) || 0), 0);

    const grossLoss = Math.abs(this.tableData
      .filter(trade => (parseFloat(trade.netProfit) || 0) < 0)
      .reduce((total, trade) => total + (parseFloat(trade.netProfit) || 0), 0));

    if (grossLoss === 0) return grossProfit > 0 ? 999 : 0;

    return parseFloat((grossProfit / grossLoss).toFixed(2));
  }

  calculateBestProfit(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;

    const profits = this.tableData.map(trade => parseFloat(trade.netProfit) || 0);
    return Math.max(...profits, 0);
  }

  calculateBestProfitPercentage(): number {
    const bestProfit = this.calculateBestProfit();
    const accountSize = this.mt5AccountInfo?.startingBalance || this.calculateAccountSize() || 5000;

    if (bestProfit <= 0 || accountSize <= 0) return 0;

    return (bestProfit / accountSize) * 100;
  }

  // Emotional tracking methods for individual trades
  getTradeKey(trade: Table): string {
    return `${trade.openDate}_${trade.symbol}_${trade.volume}`;
  }

  initializeTradeEmotionalState(trade: Table) {
    const tradeKey = this.getTradeKey(trade);
    if (!this.tradeEmotionalStates[tradeKey]) {
      this.tradeEmotionalStates[tradeKey] = {
        selectedEmotion: '',
        customEmotion: '',
        intensity: 5,
        notes: '',
        timestamp: new Date(),
        isExpanded: false,
        isSubmitted: false
      };
    }
  }

  // News helper methods
  trackByNewsIndex(index: number, item: any): number {
    return index;
  }

  formatNewsTime(time: string): string {
    if (!time || typeof time !== 'string') return '--:--';
    // Assuming time is in format like "10:30" or "3:45"
    return time;
  }

  getLatestNews(): any[] {
    if (!this.newsData || !Array.isArray(this.newsData)) {
      return [];
    }
    // Show all news for Monday to Friday
    return this.newsData;
  }

  getNewsForDay(dayNumber: number): any[] {
    if (!this.newsData || !Array.isArray(this.newsData)) {
      return [];
    }

    // Filter news by actual date
    const dayNews = this.newsData.filter(news => {
      if (!news.date) return false;

      // Parse the date string like "Tue Aug 5" or "Thu Aug 7"
      const dayAbbr = news.date.split(' ')[0]; // Get "Tue", "Thu", etc.

      // Map day abbreviations to day numbers (1=Monday, 2=Tuesday, etc.)
      const dayMap: { [key: string]: number } = {
        'Mon': 1,
        'Tue': 2,
        'Wed': 3,
        'Thu': 4,
        'Fri': 5
      };

      return dayMap[dayAbbr] === dayNumber;
    });

    return dayNews;
  }

  getGroupedNewsForDay(dayNumber: number): any[] {
    const dayNews = this.getNewsForDay(dayNumber);

    // Group news by time
    const timeGroups: { [key: string]: any[] } = {};

    dayNews.forEach(news => {
      const time = news.time || 'Unknown';
      if (!timeGroups[time]) {
        timeGroups[time] = [];
      }
      timeGroups[time].push(news);
    });

    // Convert to array of time groups with metadata
    return Object.keys(timeGroups).map(time => ({
      time,
      events: timeGroups[time],
      isMultiple: timeGroups[time].length > 1,
      expanded: false // For expandable UI
    })).sort((a, b) => {
      // Sort by time (basic string comparison works for most time formats)
      return a.time.localeCompare(b.time);
    });
  }

  getNewsTitle(news: any): string {
    const event = news?.event;
    if (!event || typeof event !== 'string') {
      return 'No event available';
    }
    return event.length > 50 ? event.slice(0, 50) + '...' : event;
  }

  getNewsImpact(news: any): string {
    if (!news || !news.impact || typeof news.impact !== 'string') {
      return 'Low';
    }
    return news.impact;
  }

  getNewsImpactClass(news: any): any {
    const impact = this.getNewsImpact(news);
    return {
      'high-impact': impact === 'High',
      'medium-impact': impact === 'Medium',
      'low-impact': impact === 'Low'
    };
  }

  getNewsImpactBadgeClass(news: any): string {
    const impact = this.getNewsImpact(news);
    return impact.toLowerCase();
  }

  shouldShowNews(): boolean {
    try {
      return !this.isNewsLoading &&
             this.newsData &&
             Array.isArray(this.newsData) &&
             this.newsData.length > 0 &&
             this.getLatestNews().length > 0;
    } catch (error) {
      console.warn('Error checking news display condition:', error);
      return false;
    }
  }

  isLoadingNews(): boolean {
    return this.isNewsLoading;
  }

  // Market Hours and Trading Days Methods
  isMarketOpen(): boolean {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = now.getHours();

    // Monday to Friday (1-5), roughly 9 AM to 5 PM (can be adjusted for forex hours)
    return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 9 && hour <= 17;
  }

  getMarketStatusClass(): string {
    return this.isMarketOpen() ? 'market-open' : 'market-closed';
  }

  getMarketStatusText(): string {
    return this.isMarketOpen() ? 'Markets Open' : 'Markets Closed';
  }

  getTradingDays(): any[] {
    const today = new Date().getDay(); // 0 = Sunday, 6 = Saturday

    return [
      { label: 'Mon', day: 1, statusClass: this.getDayStatusClass(1, today) },
      { label: 'Tue', day: 2, statusClass: this.getDayStatusClass(2, today) },
      { label: 'Wed', day: 3, statusClass: this.getDayStatusClass(3, today) },
      { label: 'Thu', day: 4, statusClass: this.getDayStatusClass(4, today) },
      { label: 'Fri', day: 5, statusClass: this.getDayStatusClass(5, today) }
    ];
  }

  private getDayStatusClass(dayNumber: number, today: number): string {
    if (dayNumber === today) {
      return this.isMarketOpen() ? 'status-active' : 'status-inactive';
    }

    // Past trading days
    if (dayNumber < today && dayNumber >= 1 && dayNumber <= 5) {
      return 'status-past';
    }

    // Future trading days
    if (dayNumber > today && dayNumber >= 1 && dayNumber <= 5) {
      return 'status-future';
    }

    return 'status-weekend';
  }

  getDayTabClass(day: any): string {
    const today = new Date().getDay();
    let classes: string[] = [];

    // Current day
    if (day.day === today) {
      classes.push('current');
      if (this.isMarketOpen()) {
        classes.push('active');
      }
    }

    // Past/Future
    if (day.day < today) {
      classes.push('past');
    } else if (day.day > today) {
      classes.push('future');
    }

    return classes.join(' ');
  }

  // Removed selectDay functionality - showing all weekday news


  getCurrentDay(): number {
    return new Date().getDay(); // 0 = Sunday, 1 = Monday, etc.
  }

  currentDayHasNews(): boolean {
    const currentDay = this.getCurrentDay();
    const newsForToday = this.getNewsForDay(currentDay);
    return newsForToday.length > 0;
  }

  getEnhancedNewsClasses(news: any, dayNumber: number): any {
    const impact = this.getNewsImpact(news);
    const isCurrentDay = dayNumber === this.getCurrentDay();

    return {
      'high-impact': impact === 'High',
      'medium-impact': impact === 'Medium',
      'low-impact': impact === 'Low',
      'current-day-item': isCurrentDay
    };
  }

  getGroupedNewsByTime(dayNumber: number): any[] {
    const dayNews = this.getNewsForDay(dayNumber);

    // Group news by time
    const timeGroups: { [key: string]: any[] } = {};

    dayNews.forEach(news => {
      const time = news.time || 'Unknown';
      if (!timeGroups[time]) {
        timeGroups[time] = [];
      }
      timeGroups[time].push(news);
    });

    // Convert to array of time groups with metadata
    return Object.keys(timeGroups).map(time => {
      const events = timeGroups[time];
      const isMultiple = events.length > 1;
      const groupId = `day-${dayNumber}-time-${time}`;


      return {
        time,
        events,
        isMultiple,
        expanded: this.timeGroupStates[groupId] || false, // Use persistent state
        currencies: [...new Set(events.map(event => event.currency))], // Unique currencies
        dominantCurrency: this.getDominantCurrency(events),
        id: groupId // Consistent ID for tracking
      };
    }).sort((a, b) => {
      // Sort by time (basic string comparison works for most time formats)
      return a.time.localeCompare(b.time);
    });
  }

  getDominantCurrency(events: any[]): string {
    // Count currency occurrences
    const currencyCount: { [key: string]: number } = {};
    events.forEach(event => {
      const currency = event.currency || 'USD';
      currencyCount[currency] = (currencyCount[currency] || 0) + 1;
    });

    // Return the most frequent currency
    return Object.keys(currencyCount).reduce((a, b) =>
      currencyCount[a] > currencyCount[b] ? a : b
    );
  }

  onTimeGroupClick(timeGroup: any): void {
    if (timeGroup.isMultiple) {
      // Show modal with grouped news details
      this.selectedTimeGroup = timeGroup;
      this.showNewsModal = true;
      this.cdr.detectChanges();
    }
  }

  closeNewsModal(): void {
    this.showNewsModal = false;
    this.selectedTimeGroup = null;
    this.cdr.detectChanges();
  }

  toggleTimeGroup(timeGroup: any): void {
    timeGroup.expanded = !timeGroup.expanded;
    this.cdr.detectChanges(); // Force change detection
  }

  getCurrencyBackgroundClass(currency: string): string {
    const currencyMap: { [key: string]: string } = {
      'USD': 'currency-usd',
      'EUR': 'currency-eur',
      'GBP': 'currency-gbp',
      'JPY': 'currency-jpy',
      'AUD': 'currency-aud',
      'CAD': 'currency-cad',
      'CHF': 'currency-chf',
      'NZD': 'currency-nzd'
    };

    return currencyMap[currency] || 'currency-default';
  }

  trackByDayIndex(index: number, item: any): number {
    return item.day;
  }

  toggleTradeEmotionalForm(trade: Table) {
    const tradeKey = this.getTradeKey(trade);
    this.initializeTradeEmotionalState(trade);
    this.tradeEmotionalStates[tradeKey].isExpanded = !this.tradeEmotionalStates[tradeKey].isExpanded;
  }

  selectEmotionForTrade(trade: Table, emotion: any) {
    const tradeKey = this.getTradeKey(trade);
    this.initializeTradeEmotionalState(trade);
    this.tradeEmotionalStates[tradeKey].selectedEmotion = emotion.name;
    this.tradeEmotionalStates[tradeKey].customEmotion = ''; // Clear custom if predefined is selected
  }

  onCustomEmotionChangeForTrade(trade: Table) {
    const tradeKey = this.getTradeKey(trade);
    if (this.tradeEmotionalStates[tradeKey]?.customEmotion?.trim()) {
      this.tradeEmotionalStates[tradeKey].selectedEmotion = ''; // Clear predefined if custom is entered
    }
  }

  updateTradeCustomEmotion(trade: Table, value: string) {
    const tradeKey = this.getTradeKey(trade);
    this.initializeTradeEmotionalState(trade);
    this.tradeEmotionalStates[tradeKey].customEmotion = value;
    if (value.trim()) {
      this.tradeEmotionalStates[tradeKey].selectedEmotion = ''; // Clear predefined if custom is entered
    }
  }

  updateTradeIntensity(trade: Table, value: number) {
    const tradeKey = this.getTradeKey(trade);
    this.initializeTradeEmotionalState(trade);
    this.tradeEmotionalStates[tradeKey].intensity = value;
  }

  updateTradeNotes(trade: Table, value: string) {
    const tradeKey = this.getTradeKey(trade);
    this.initializeTradeEmotionalState(trade);
    this.tradeEmotionalStates[tradeKey].notes = value;
  }

  submitEmotionalEntryForTrade(trade: Table) {
    const tradeKey = this.getTradeKey(trade);
    const emotionalState = this.tradeEmotionalStates[tradeKey];

    if (!emotionalState) return;

    const emotion = emotionalState.selectedEmotion || emotionalState.customEmotion;

    if (!emotion.trim()) {
      alert('Please select an emotion or enter a custom emotion.');
      return;
    }

    const entry = {
      id: Date.now().toString(),
      tradeKey: tradeKey,
      emotion: emotion,
      intensity: emotionalState.intensity,
      notes: emotionalState.notes,
      timestamp: new Date(),
      tradeContext: `${trade.type} ${trade.symbol} - ${trade.volume} lots`,
      tradeDetails: {
        openDate: trade.openDate,
        symbol: trade.symbol,
        type: trade.type,
        volume: trade.volume,
        netProfit: trade.netProfit
      },
      isCustom: !emotionalState.selectedEmotion
    };

    this.emotionalEntries.unshift(entry);

    // Mark as submitted and collapse
    this.tradeEmotionalStates[tradeKey].isSubmitted = true;
    this.tradeEmotionalStates[tradeKey].isExpanded = false;

    // TODO: In the future, send to Notion API
    console.log('💭 Emotional entry recorded for trade:', entry);

    // Show confirmation
    alert(`Emotional state "${emotion}" recorded for ${trade.symbol} trade! This will be synced to Notion in the future.`);
  }

  getTradeEmotionalState(trade: Table) {
    const tradeKey = this.getTradeKey(trade);
    return this.tradeEmotionalStates[tradeKey];
  }

  isTradeEmotionalFormExpanded(trade: Table): boolean {
    const state = this.getTradeEmotionalState(trade);
    return state?.isExpanded || false;
  }

  isTradeEmotionalSubmitted(trade: Table): boolean {
    const state = this.getTradeEmotionalState(trade);
    return state?.isSubmitted || false;
  }

  getEmotionIcon(emotionName: string): string {
    const emotion = this.predefinedEmotions.find(e => e.name === emotionName);
    return emotion ? emotion.icon : '💭';
  }

  getEmotionColor(emotionName: string): string {
    const emotion = this.predefinedEmotions.find(e => e.name === emotionName);
    return emotion ? emotion.color : '#6b7280';
  }

  formatEmotionalTimestamp(timestamp: Date): string {
    return timestamp.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getSubmittedEmotion(trade: Table): string {
    const entry = this.emotionalEntries.find(e => e.tradeKey === this.getTradeKey(trade));
    return entry?.emotion || '';
  }

  getSubmittedIntensity(trade: Table): number {
    const entry = this.emotionalEntries.find(e => e.tradeKey === this.getTradeKey(trade));
    return entry?.intensity || 5;
  }




  calculateHoldTime(openDateStr: string, closeDateStr: string): string {
    if (!openDateStr || !closeDateStr) return '';

    try {
      // Parse the MT5 date format: "MM.DD.YYYY HH:mm"
      const parseDate = (dateStr: string): Date | null => {
        const [datePart, timePart] = dateStr.split(' ');
        if (!datePart || !timePart) return null;

        const [month, day, year] = datePart.split('.');
        const [hour, minute] = timePart.split(':');

        if (!month || !day || !year || !hour || !minute) return null;

        return new Date(
          parseInt(year),
          parseInt(month) - 1, // JavaScript months are 0-based
          parseInt(day),
          parseInt(hour),
          parseInt(minute)
        );
      };

      const openDate = parseDate(openDateStr);
      const closeDate = parseDate(closeDateStr);

      if (!openDate || !closeDate) return '';

      // Calculate the difference in milliseconds
      const diffMs = closeDate.getTime() - openDate.getTime();

      if (diffMs < 0) return ''; // Invalid: close before open

      // Convert to minutes
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      // Calculate hours and remaining minutes
      const hours = Math.floor(diffMinutes / 60);
      const minutes = diffMinutes % 60;

      // Format as "Xhrs Ymin" or "Xmin"
      if (hours > 0 && minutes > 0) {
        return `${hours}hrs ${minutes}min`;
      } else if (hours > 0) {
        return `${hours}hrs`;
      } else if (minutes > 0) {
        return `${minutes}min`;
      } else {
        return `<1min`;
      }

    } catch (error) {
      console.error('Error calculating hold time:', error);
      return '';
    }
  }

  formatDate(dateStr: string): string {
    // if (!dateStr) return '';
    try {
      // Handle MM.DD.YYYY HH:mm format
      const [datePart, timePart] = dateStr.split(' ');
      if (!datePart) return dateStr;

      const [month, day, year] = datePart.split('.');
      if (month && day && year) {
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (timePart) {
          const [hours, minutes] = timePart.split(':');
          if (hours && minutes) {
            date.setHours(parseInt(hours), parseInt(minutes));
            return date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
          }
        }
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      }
    } catch (error) {
      console.error('Error formatting date:', error);
    }
    return dateStr;
  }

  calculateDayPnL(events: any[]): number {
    if (!events || events.length === 0) return 0;
    return events.reduce((sum, event) => {
      return sum + (event.meta?.profit || 0);
    }, 0);
  }

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

  // Utility method for templates
  parseFloat(value: string): number {
    return parseFloat(value) || 0;
  }

  // Helper method to check if there are critical insights
  hasCriticalInsights(): boolean {
    return this.getPerformanceInsights().some(insight => insight.severity === 'critical');
  }

  // Advanced Trading Analytics Methods

  // Risk Management KPIs
  getMaxDrawdown(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;

    let runningBalance = 0;
    let peak = 0;
    let maxDrawdown = 0;

    this.tableData.forEach(trade => {
      const tradeProfit = parseFloat(trade.netProfit) || 0;
      runningBalance += tradeProfit;

      if (runningBalance > peak) {
        peak = runningBalance;
      }

      const drawdown = peak - runningBalance;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    });

    return -maxDrawdown;
  }

  getMaxDrawdownPercent(): string {
    const maxDrawdown = Math.abs(this.getMaxDrawdown());
    const initialBalance = 5000; // Prop firm account value
    return ((maxDrawdown / initialBalance) * 100).toFixed(2);
  }

  getCurrentDrawdown(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;

    let runningBalance = 0;
    let peak = 0;

    this.tableData.forEach(trade => {
      const tradeProfit = parseFloat(trade.netProfit) || 0;
      runningBalance += tradeProfit;

      if (runningBalance > peak) {
        peak = runningBalance;
      }
    });

    return runningBalance - peak;
  }

  getRiskRewardRatio(): string {
    const avgWin = this.calculateAvgWin();
    const avgLoss = Math.abs(this.calculateAvgLoss());

    if (avgLoss === 0) return '0.00';
    return (avgWin / avgLoss).toFixed(2);
  }

  getProfitFactor(): string {
    if (!this.tableData || this.tableData.length === 0) return '0.00';

    const totalWins = this.tableData
      .filter(trade => parseFloat(trade.netProfit) > 0)
      .reduce((sum, trade) => sum + parseFloat(trade.netProfit), 0);

    const totalLosses = Math.abs(this.tableData
      .filter(trade => parseFloat(trade.netProfit) < 0)
      .reduce((sum, trade) => sum + parseFloat(trade.netProfit), 0));

    if (totalLosses === 0) return totalWins > 0 ? '∞' : '0.00';
    return (totalWins / totalLosses).toFixed(2);
  }

  getAvgRiskPerTrade(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;

    const totalRisk = this.tableData.reduce((sum, trade) => {
      const entry = parseFloat(trade.entry) || 0;
      const stopLoss = parseFloat(trade.sL) || 0;
      const volume = parseFloat(trade.volume) || 0;

      if (entry && stopLoss && volume) {
        const riskPerUnit = Math.abs(entry - stopLoss);
        return sum + (riskPerUnit * volume);
      }
      return sum;
    }, 0);

    return totalRisk / this.tableData.length;
  }

  getKellyCriterion(): string {
    const winRate = this.calculateWinRate() / 100;
    const avgWin = this.calculateAvgWin();
    const avgLoss = Math.abs(this.calculateAvgLoss());

    if (avgLoss === 0) return '0.00';

    const kelly = winRate - ((1 - winRate) / (avgWin / avgLoss));
    return (kelly * 100).toFixed(2);
  }

  // Trading Psychology Indicators
  getRevengeTradingScore(): number {
    if (!this.tableData || this.tableData.length < 2) return 0;

    let revengeTradeCount = 0;

    for (let i = 1; i < this.tableData.length; i++) {
      const prevTrade = parseFloat(this.tableData[i-1].netProfit) || 0;
      const currentTrade = parseFloat(this.tableData[i].netProfit) || 0;
      const currentVolume = parseFloat(this.tableData[i].volume) || 0;
      const prevVolume = parseFloat(this.tableData[i-1].volume) || 0;

      // Check if previous trade was a loss and current trade has increased volume
      if (prevTrade < 0 && currentVolume > prevVolume * 1.5) {
        revengeTradeCount++;
      }
    }

    return Math.min(100, (revengeTradeCount / (this.tableData.length - 1)) * 100);
  }

  getRevengeTradingClass(): string {
    const score = this.getRevengeTradingScore();
    if (score > 30) return 'high-risk';
    if (score > 15) return 'medium-risk';
    return 'low-risk';
  }

  getOvertradingScore(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;

    // Group trades by day
    const tradesByDay: { [key: string]: number } = {};

    this.tableData.forEach(trade => {
      const date = trade.openDate.split(' ')[0]; // Get date part only
      tradesByDay[date] = (tradesByDay[date] || 0) + 1;
    });

    const dailyTradeCounts = Object.values(tradesByDay);
    const avgTradesPerDay = dailyTradeCounts.reduce((sum, count) => sum + count, 0) / dailyTradeCounts.length;

    // Calculate days with excessive trading (more than 2x average)
    const excessiveTradingDays = dailyTradeCounts.filter(count => count > avgTradesPerDay * 2).length;

    return Math.min(100, (excessiveTradingDays / dailyTradeCounts.length) * 100);
  }

  getOvertradingClass(): string {
    const score = this.getOvertradingScore();
    if (score > 40) return 'high-risk';
    if (score > 20) return 'medium-risk';
    return 'low-risk';
  }

  getFOMOScore(): number {
    if (!this.tableData || this.tableData.length < 3) return 0;

    let fomoTradeCount = 0;

    for (let i = 2; i < this.tableData.length; i++) {
      const trade1 = parseFloat(this.tableData[i-2].netProfit) || 0;
      const trade2 = parseFloat(this.tableData[i-1].netProfit) || 0;
      const currentTrade = parseFloat(this.tableData[i].netProfit) || 0;

      // FOMO: Two consecutive wins followed by a quick loss
      if (trade1 > 0 && trade2 > 0 && currentTrade < 0) {
        const timeDiff = this.getTimeDifferenceBetweenTrades(i-1, i);
        if (timeDiff < 30) { // Less than 30 minutes
          fomoTradeCount++;
        }
      }
    }

    return Math.min(100, (fomoTradeCount / (this.tableData.length - 2)) * 100);
  }

  getFOMOClass(): string {
    const score = this.getFOMOScore();
    if (score > 25) return 'high-risk';
    if (score > 10) return 'medium-risk';
    return 'low-risk';
  }

  getStopLossAdherence(): number {
    if (!this.tableData || this.tableData.length === 0) return 100;

    const tradesWithSL = this.tableData.filter(trade => {
      const sl = parseFloat(trade.sL);
      return sl && sl > 0;
    });

    if (tradesWithSL.length === 0) return 0;
    const adherentTrades = tradesWithSL.filter(trade => {
      const entry = parseFloat(trade.entry);
      const exit = parseFloat(trade.exit);
      const sl = parseFloat(trade.sL);
      const profit = parseFloat(trade.netProfit);

      // If it's a loss, check if exit price is close to SL
      if (profit < 0) {
        const tradeType = trade.type ? trade.type.toString().toLowerCase() : '';
        if (tradeType === 'buy') {
          return exit <= sl * 1.05; // 5% tolerance
        } else {
          return exit >= sl * 0.95; // 5% tolerance
        }
      }
      return true; // Winning trades are considered adherent
    });

    return (adherentTrades.length / tradesWithSL.length) * 100;
  }

  getStopLossAdherenceClass(): string {
    const score = this.getStopLossAdherence();
    if (score > 80) return 'high-discipline';
    if (score > 60) return 'medium-discipline';
    return 'low-discipline';
  }

  getTakeProfitDiscipline(): number {
    if (!this.tableData || this.tableData.length === 0) return 100;

    const winningTrades = this.tableData.filter(trade => parseFloat(trade.netProfit) > 0);

    if (winningTrades.length === 0) return 0;

    const disciplinedTrades = winningTrades.filter(trade => {
      const entry = parseFloat(trade.entry);
      const exit = parseFloat(trade.exit);
      const tp = parseFloat(trade.tP);

      if (!tp || tp === 0) return false;

      const tradeType = trade.type ? trade.type.toString().toLowerCase() : '';
      if (tradeType === 'buy') {
        return exit >= tp * 0.95; // Took profit close to target
      } else {
        return exit <= tp * 1.05; // Took profit close to target
      }
    });

    return (disciplinedTrades.length / winningTrades.length) * 100;
  }

  getTakeProfitDisciplineClass(): string {
    const score = this.getTakeProfitDiscipline();
    if (score > 70) return 'high-discipline';
    if (score > 50) return 'medium-discipline';
    return 'low-discipline';
  }

  // Time-based Analysis
  getBestTradingDay(): { day: string, avgPnL: number } {
    const dayStats = this.getDayOfWeekStats();
    if (dayStats.length === 0) return { day: 'N/A', avgPnL: 0 };
    const bestDay = dayStats.reduce((best, current) =>
      current.avgPnL > best.avgPnL ? current : best
    );
    return { day: bestDay.day, avgPnL: bestDay.avgPnL };
  }

  getWorstTradingDay(): { day: string, avgPnL: number } {
    const dayStats = this.getDayOfWeekStats();
    if (dayStats.length === 0) return { day: 'N/A', avgPnL: 0 };
    const worstDay = dayStats.reduce((worst, current) =>
      current.avgPnL < worst.avgPnL ? current : worst
    );
    return { day: worstDay.day, avgPnL: worstDay.avgPnL };
  }

  getDayOfWeekStats(): { day: string, avgPnL: number, tradeCount: number }[] {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayStats: { [key: number]: { totalPnL: number, count: number } } = {};

    this.tableData.forEach(trade => {
      const date = this.parseTradeDate(trade.openDate);
      if (date) {
        const dayOfWeek = date.getDay();
        const pnl = parseFloat(trade.netProfit) || 0;

        if (!dayStats[dayOfWeek]) {
          dayStats[dayOfWeek] = { totalPnL: 0, count: 0 };
        }

        dayStats[dayOfWeek].totalPnL += pnl;
        dayStats[dayOfWeek].count++;
      }
    });

    return Object.keys(dayStats).map(dayIndex => {
      const index = parseInt(dayIndex);
      const stats = dayStats[index];
      return {
        day: dayNames[index],
        avgPnL: stats.totalPnL / stats.count,
        tradeCount: stats.count
      };
    });
  }

  getTradingSessionStats(): { name: string, avgPnL: number, tradeCount: number }[] {
    const sessions = [
      { name: 'Asian', start: 0, end: 8 },
      { name: 'London', start: 8, end: 16 },
      { name: 'New York', start: 16, end: 24 }
    ];

    const sessionStats = sessions.map(session => {
      const sessionTrades = this.tableData.filter(trade => {
        const date = this.parseTradeDate(trade.openDate);
        if (date) {
          const hour = date.getHours();
          return hour >= session.start && hour < session.end;
        }
        return false;
      });

      const totalPnL = sessionTrades.reduce((sum, trade) => sum + (parseFloat(trade.netProfit) || 0), 0);
      const avgPnL = sessionTrades.length > 0 ? totalPnL / sessionTrades.length : 0;

      return {
        name: session.name,
        avgPnL,
        tradeCount: sessionTrades.length
      };
    });

    return sessionStats;
  }

  // Consecutive Trades Analysis
  getMaxConsecutiveWins(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;

    let maxWins = 0;
    let currentWins = 0;

    this.tableData.forEach(trade => {
      const profit = parseFloat(trade.netProfit) || 0;
      if (profit > 0) {
        currentWins++;
        maxWins = Math.max(maxWins, currentWins);
      } else {
        currentWins = 0;
      }
    });

    return maxWins;
  }

  getMaxConsecutiveLosses(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;

    let maxLosses = 0;
    let currentLosses = 0;

    this.tableData.forEach(trade => {
      const profit = parseFloat(trade.netProfit) || 0;
      if (profit < 0) {
        currentLosses++;
        maxLosses = Math.max(maxLosses, currentLosses);
      } else {
        currentLosses = 0;
      }
    });

    return maxLosses;
  }

  getCurrentStreak(): string {
    if (!this.tableData || this.tableData.length === 0) return '0';

    let streak = 0;
    let isWinStreak = false;

    for (let i = this.tableData.length - 1; i >= 0; i--) {
      const profit = parseFloat(this.tableData[i].netProfit) || 0;

      if (i === this.tableData.length - 1) {
        isWinStreak = profit > 0;
        streak = 1;
      } else {
        if ((isWinStreak && profit > 0) || (!isWinStreak && profit < 0)) {
          streak++;
        } else {
          break;
        }
      }
    }

    return `${streak} ${isWinStreak ? 'W' : 'L'}`;
  }

  getCurrentStreakClass(): string {
    const streak = this.getCurrentStreak();
    if (streak.includes('W')) return 'positive';
    if (streak.includes('L')) {
      const count = parseInt(streak.split(' ')[0]);
      return count > 3 ? 'high-risk' : 'negative';
    }
    return 'neutral';
  }

  getAvgRecoveryTime(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;

    const recoveryTimes: number[] = [];
    let lossStreak = 0;

    this.tableData.forEach(trade => {
      const profit = parseFloat(trade.netProfit) || 0;

      if (profit < 0) {
        lossStreak++;
      } else if (lossStreak > 0) {
        recoveryTimes.push(lossStreak);
        lossStreak = 0;
      }
    });

    return recoveryTimes.length > 0 ?
      recoveryTimes.reduce((sum, time) => sum + time, 0) / recoveryTimes.length : 0;
  }

  // Performance Heatmap
  getPerformanceHeatmap(): { value: number, class: string, tooltip: string }[] {
    const last30Days: { value: number, class: string, tooltip: string }[] = [];

    // Debug: log table data info
    // console.log('Total trades in tableData:', this.tableData.length);
    if (this.tableData.length > 0) {
      // console.log('First trade date:', this.tableData[0].openDate);
      // console.log('Last trade date:', this.tableData[this.tableData.length - 1].openDate);
    }

    // Instead of using today's date, let's use the date range from the actual trades
    if (!this.tableData || this.tableData.length === 0) {
      // If no trades, show empty heatmap for last 30 days
      const today = new Date();
      for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        last30Days.push({
          value: 0,
          class: 'neutral',
          tooltip: `${date.toLocaleDateString()}: 0 trades, 0.00 P&L`
        });
      }
      return last30Days;
    }

    // Find the date range of the trades
    const tradeDates = this.tableData.map(trade => this.parseTradeDate(trade.openDate)).filter(date => date !== null) as Date[];
    const minDate = new Date(Math.min(...tradeDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...tradeDates.map(d => d.getTime())));

    // console.log('Trade date range:', minDate.toDateString(), 'to', maxDate.toDateString());

    // Use the actual trade date range to show the last 30 days from the most recent trade
    const endDate = maxDate;

    for (let i = 29; i >= 0; i--) {
      const date = new Date(endDate);
      date.setDate(date.getDate() - i);

      const dayTrades = this.tableData.filter(trade => {
        const tradeDate = this.parseTradeDate(trade.openDate);
        if (!tradeDate) return false;

        // Compare just the date part (year, month, day)
        return tradeDate.getFullYear() === date.getFullYear() &&
               tradeDate.getMonth() === date.getMonth() &&
               tradeDate.getDate() === date.getDate();
      });

      const dayPnL = dayTrades.reduce((sum, trade) => sum + (parseFloat(trade.netProfit) || 0), 0);

      let cellClass = 'neutral';
      if (dayPnL > 50) cellClass = 'positive-high';
      else if (dayPnL > 25) cellClass = 'positive-med';
      else if (dayPnL > 0) cellClass = 'positive-low';
      else if (dayPnL < -50) cellClass = 'negative-high';
      else if (dayPnL < -25) cellClass = 'negative-med';
      else if (dayPnL < 0) cellClass = 'negative-low';

      // console.log(`Date: ${date.toLocaleDateString()}, Trades: ${dayTrades.length}, P&L: ${dayPnL.toFixed(2)}, Class: ${cellClass}`);

      last30Days.push({
        value: dayPnL,
        class: cellClass,
        tooltip: `${date.toLocaleDateString()}: ${dayTrades.length} trades, ${dayPnL.toFixed(2)} P&L`
      });
    }

    return last30Days;
  }

  // Performance Insights
  getPerformanceInsights(): { title: string, description: string, recommendations: string[], severity: string }[] {
    const insights: { title: string, description: string, recommendations: string[], severity: string }[] = [];

    // Win Rate Analysis
    const winRate = this.calculateWinRate();
    if (winRate < 40) {
      insights.push({
        title: '🎯 Low Win Rate Detected',
        description: `Your win rate of ${winRate.toFixed(1)}% is below the typical 40-60% range for successful traders.`,
        recommendations: [
          'Review your entry criteria - you may be entering trades with poor setups',
          'Consider tightening your trade selection process',
          'Focus on high-probability setups only',
          'Backtest your strategy to validate its effectiveness'
        ],
        severity: 'critical'
      });
    }

    // Risk/Reward Analysis
    const rrRatio = parseFloat(this.getRiskRewardRatio());
    if (rrRatio < 1.5) {
      insights.push({
        title: '⚖️ Poor Risk/Reward Ratio',
        description: `Your risk/reward ratio of ${rrRatio} means you're risking too much for too little reward.`,
        recommendations: [
          'Aim for at least 1:2 risk/reward ratio on trades',
          'Let your winners run longer before taking profit',
          'Consider wider take profit targets',
          'Review if you\'re cutting winners too early'
        ],
        severity: 'warning'
      });
    }

    // Revenge Trading
    const revengeScore = this.getRevengeTradingScore();
    if (revengeScore > 20) {
      insights.push({
        title: '😤 Revenge Trading Pattern',
        description: `${revengeScore.toFixed(1)}% of your trades show signs of revenge trading after losses.`,
        recommendations: [
          'Take a break after a losing trade to reset emotionally',
          'Set a maximum daily loss limit and stick to it',
          'Keep a trading journal to identify emotional triggers',
          'Never increase position size after a loss'
        ],
        severity: 'critical'
      });
    }

    // Overtrading
    const overtradingScore = this.getOvertradingScore();
    if (overtradingScore > 30) {
      insights.push({
        title: '📈 Overtrading Detected',
        description: `You have excessive trading days suggesting overtrading behavior.`,
        recommendations: [
          'Set a maximum number of trades per day (e.g., 3-5 trades)',
          'Focus on quality over quantity',
          'Wait for high-probability setups only',
          'Take time to analyze the market before entering'
        ],
        severity: 'warning'
      });
    }

    // Drawdown Analysis
    const maxDrawdown = Math.abs(this.getMaxDrawdown());
    if (maxDrawdown > 1000) {
      insights.push({
        title: '📉 High Drawdown Risk',
        description: `Your maximum drawdown of $${maxDrawdown.toFixed(2)} indicates high risk exposure.`,
        recommendations: [
          'Reduce position sizes to limit account risk',
          'Implement stricter stop losses',
          'Never risk more than 1-2% of account per trade',
          'Consider a period of paper trading to rebuild confidence'
        ],
        severity: 'critical'
      });
    }

    // Positive insights
    if (insights.length === 0) {
      insights.push({
        title: '✅ Good Trading Performance',
        description: 'Your trading shows good discipline and risk management.',
        recommendations: [
          'Continue following your current strategy',
          'Consider gradually increasing position sizes',
          'Document what\'s working well in your trading journal',
          'Stay consistent with your approach'
        ],
        severity: 'success'
      });
    }

    return insights;
  }

  // Helper Methods
  private getTimeDifferenceBetweenTrades(index1: number, index2: number): number {
    if (!this.tableData[index1] || !this.tableData[index2]) return 0;

    const date1 = this.parseTradeDate(this.tableData[index1].openDate);
    const date2 = this.parseTradeDate(this.tableData[index2].openDate);

    if (!date1 || !date2) return 0;

    return Math.abs(date2.getTime() - date1.getTime()) / (1000 * 60); // difference in minutes
  }

  // loadTrades(): Promise<void> {
  //   return new Promise((resolve, reject) => {
  //     const tradesRef = collection(this.firestore, 'trades');
  //     getDocs(tradesRef).then((querySnapshot) => {
  //       const firestoreTrades = querySnapshot.docs.map(doc => doc.data()['rowData']);
  //       console.log("��� Loaded from Firestore:", firestoreTrades.length, "trades");

  //       // Don't overwrite existing tableData, merge with MT5 trades
  //       if (this.mt5LiveTrades.length > 0) {
  //         console.log("🔴 Preserving existing MT5 trades:", this.mt5LiveTrades.length);
  //         // Keep MT5 trades and add Firestore trades
  //         this.tableData = [...this.mt5LiveTrades, ...firestoreTrades];
  //       } else {
  //         this.tableData = firestoreTrades;
  //       }

  //       console.log("📊 Final tableData after loadTrades:", this.tableData.length);
  //       resolve(); // Notify that loading is done
  //     }).catch((error) => {
  //       console.error('Error loading trades:', error);
  //       reject(error);
  //     });
  //   });
  // }

  async loadMT5Data(): Promise<void> {
    try {
      const response = await this.getMt5API();
      if (response && response.length > 0) {
        const mt5Trades = response.map((trade: any) => { 
          return {
            openDate: this.convertAndFormatMT5Date(trade.time_open),
            closeDate: trade.time_close? this.convertAndFormatMT5Date(trade.time_close): "-",
            tradeNotion: [],
            status: "",
            position: trade.position_id,
            symbol: trade.symbol || '',
            type: trade.type === 0 ? 'Buy' : 'Sell',
            volume: trade.volume ? trade.volume.toString() : '0',
            entry: trade.entry_price ? +parseFloat(trade.entry_price).toFixed(5) : '0',
            sL: trade.sl ? trade.sl.toString() : '0',
            tP: trade.tp ? trade.tp.toString() : '0',
            exit: trade.price_current ? trade.price_current.toString() : '0',
            commission: trade.commission ? trade.commission.toString() : '0',
            swap: trade.swap ? trade.swap.toString() : '0',
            profit: trade.profit ? trade.profit.toString() : '0',
            netProfit: (trade.profit + trade.commission).toString(),
            riskPerTrade: trade.risk_usd? trade.risk_usd.toString() :'0',
            rrr:trade.reward_risk_ratio ? trade.reward_risk_ratio.toString(): '0',
            mt5status: trade.status || '',
            mfe: '0', // Initialize MFE to 0 for loaded MT5 trades
          } as Table;
        });

        this.mt5LiveTrades = mt5Trades;
        console.log("this.mt5LiveTrades", this.mt5LiveTrades);
        this.updateTableData();

        // Generate stunning chart with loaded data
        setTimeout(() => {
          this.generateTradingChartData();
        }, 500);
      }

     // Go to last page of the table to show the latest trade
     this.setPage(this.getTotalPages());
    } catch (error) {
        console.error('Error loading MT5 data:', error);
    }
  }


  convertAndFormatMT5Date(rawDateStr: string): string { //MT5 api date format->  time_close: "2025-07-24 09:56:01"
    const [datePart, timePart] = rawDateStr.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = timePart.split(':').map(Number);

    const dateObj = new Date(year, month - 1, day, hour, minute, second);
    dateObj.setHours(dateObj.getHours() + 5); // Adjust timezone if needed

    return `${String(dateObj.getMonth() + 1).padStart(2, '0')}.${String(dateObj.getDate()).padStart(2, '0')}.${dateObj.getFullYear()} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
  }

  mockMT5newTrade(){
    console.log('🚀 Mock button clicked! Current state:');
    console.log('📊 Current tableData length:', this.tableData.length);
    console.log('��� Current mt5LiveTrades length:', this.mt5LiveTrades.length);

    // Generate random mock data for testing
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'];
    const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
    const randomVolume = (Math.random() * 2 + 0.1).toFixed(2); // 0.1 to 2.1
    const randomPrice = (1.0000 + Math.random() * 0.5000).toFixed(4); // 1.0000 to 1.5000
    const randomProfit = (Math.random() * 200 - 100).toFixed(2); // -100 to +100
    const mockTicket = Math.floor(Math.random() * 999999999) + 100000000; // 9-digit ticket

    const mock = {
      "ticket": mockTicket,
      "symbol": randomSymbol,
      "volume": parseFloat(randomVolume),
      "type": Math.floor(Math.random() * 2), // 0 for Buy, 1 for Sell
      "price_open": parseFloat(randomPrice),
      "sl": (parseFloat(randomPrice) - 0.0100).toFixed(4),
      "tp": (parseFloat(randomPrice) + 0.0150).toFixed(4),
      "profit": parseFloat(randomProfit),
      "time": new Date().toISOString().slice(0, 19).replace('T', ' '),
      "commission": (Math.random() * 5).toFixed(2),
    }

    console.log('🎯 Generated mock trade:', mock);
    this.addMT5LiveTrade(mock);

    // Simulate price updates to show MFE in action
    setTimeout(() => {
      this.simulateMFEUpdates(mockTicket);
    }, 2000);
  }

  simulateMFEUpdates(ticket: number): void {
    console.log('📈 Starting MFE simulation for ticket:', ticket);
    let updateCount = 0;
    const maxUpdates = 10;

    const interval = setInterval(() => {
      updateCount++;

      // Simulate increasing profit to show MFE tracking
      const currentProfit = 10 + (updateCount * 15) + (Math.random() * 10 - 5); // Generally increasing profit

      const priceUpdateData = {
        ticket: ticket.toString(),
        profit: currentProfit,
        price_current: (1.2500 + Math.random() * 0.01).toFixed(5)
      };

      console.log(`💰 MFE Update ${updateCount}:`, priceUpdateData);
      this.updateMT5TradePrice(priceUpdateData);

      if (updateCount >= maxUpdates) {
        clearInterval(interval);
        console.log('✅ MFE simulation completed');
      }
    }, 1000); // Update every second for demo
  }

  mockMT5closeTrade(){
    const mock = {
      "ticket": this.mockTicket,
      "symbol": "test",
      "volume": 1.00,
      "type": Math.floor(Math.random() * 2), // 0 for Buy, 1 for Sell
      "price_open": 'test',
      "sl": "test",
      "tp": "test",
      "profit": parseFloat((Math.random() * 200 - 100).toFixed(2)),
      "time": new Date().toISOString().slice(0, 19).replace('T', ' '),
      "commission": (Math.random() * 5).toFixed(2),
    }

    console.log('🎯 Generated mock trade:', mock);
    this.closeMT5Trade(mock);
  }

  addMT5LiveTrade(tradeData: any): void {
    const trade = tradeData;
    if (!trade) return;
    console.log("Open date from MT5:",trade.time_open)
    const newTrade: Table = {
      openDate: this.convertAndFormatMT5Date(trade.time_open),
      closeDate: "-",
      tradeNotion: [],
      status: "",
      position: trade.ticket,
      symbol: trade.symbol || '',
      type: trade.type === 0 ? 'Buy' : 'Sell',
      volume: trade.volume ? trade.volume.toString() : 0,
      entry: trade.price_open ? trade.price_open.toFixed(5) : 0,
      sL: trade.sl ? trade.sl.toString() : 0,
      tP: trade.tp ? trade.tp.toString() : 0,
      exit: "-",
      commission: trade.commission ? trade.commission.toString() : '0',
      swap: "-",
      profit: trade.profit ? trade.profit.toString() : '0',
      netProfit: trade.profit ? trade.profit.toString() : '0',
      riskPerTrade: trade.risk_usd ? trade.risk_usd.toString() :'0',
      rrr: trade.reward_risk_ratio ? trade.reward_risk_ratio.toString() :'0',
      mt5status: trade.status || '',
      mfe: '0', // Initialize MFE to 0 for new live trades
    };

    const existingIndex = this.mt5LiveTrades.findIndex(t =>
      t.position === newTrade.position
    );
    console.log('🔄 Adding MT5 live trade:', newTrade, 'Existing index:', existingIndex);
    if (existingIndex == -1) {
      console.log('✅ Adding new trade to mt5LiveTrades...');
      this.mt5LiveTrades.push(newTrade)
      console.log('🔴 mt5LiveTrades after add:', this.mt5LiveTrades.length);

      this.updateTableData();
      console.log('📊 tableData after update:', this.tableData.length);

      // Track as recently added for visual indication
      this.recentlyAddedTrades.unshift(newTrade);

      // Remove from recent list after 5 seconds
      // setTimeout(() => {
      //   const index = this.recentlyAddedTrades.indexOf(newTrade);
      //   if (index > -1) {
      //     this.recentlyAddedTrades.splice(index, 1);
      //   }
      // }, 5000);

      // Update the beautiful chart with new data
      this.updateChartWithNewTrade(newTrade);

      // Force Angular change detection for immediate display
      this.cdr.detectChanges();

      // Go to last page of the table to show the latest trade
      this.setPage(this.getTotalPages());

      //call Notion api to add new entry
      this.createNewEntry(newTrade);

    } else {
      console.log('⚠️ Trade already exists, skipping duplicate');
    }
  }

  // Close MT5 trade when closed
  closeMT5Trade(tradeData: any): void {
    console.log('🔄 Closing MT5 trade:', tradeData);
    const trade = tradeData;

    const liveIndex = this.mt5LiveTrades.findIndex(t =>
      t.position === trade.ticket 
    );

    if (liveIndex !== -1) {
      const closedTrade = { ...this.mt5LiveTrades[liveIndex] };
      console.log('🔴 Found live trade to be close at:', closedTrade);
      // closedTrade.status= "Closed";
      closedTrade.closeDate= trade.time_close ? this.convertAndFormatMT5Date(trade.time_close) : '0';
      closedTrade.exit= trade.price_close ? trade.price_close.toString() : '0';
      closedTrade.profit= trade.profit ? trade.profit.toString() : '0';
      closedTrade.rrr= trade.reward_risk_ratio ? trade.reward_risk_ratio.toString() : '0';

      this.mt5LiveTrades[liveIndex] = closedTrade;

      //call Notion api to update an existing entry for closed trade
      this.updateExistingEntry(closedTrade);  


      // this.mt5LiveTrades.splice(liveIndex, 1);
      this.updateTableData();

      // Update the beautiful chart with closed trade
      this.updateChartWithClosedTrade(closedTrade);

      console.log('✅ MT5 trade closed');
    }
  }

  updateMT5TradePrice(priceData: any): void {
    const tradeIndex = this.mt5LiveTrades.findIndex(trade =>
      trade.position === priceData.ticket
    );

    if (tradeIndex !== -1) {
      const trade = this.mt5LiveTrades[tradeIndex];
      const currentProfit = priceData.profit ? parseFloat(priceData.profit.toString()) : 0;

      // Update current profit values
      trade.profit = priceData.profit ? priceData.profit.toString() : '0';
      trade.netProfit = priceData.profit ? priceData.profit.toString() : '0';

      // Track MFE (Maximum Favorable Excursion) - only increases when profit goes higher
      const currentMfe = parseFloat(trade.mfe || '0');
      if (currentProfit > 0 && currentProfit > currentMfe) {
        trade.mfe = currentProfit.toString();
      } else if (!trade.mfe) {
        // Initialize MFE to 0 if not set
        trade.mfe = '0';
      }

      this.updateTableDataOnly();

      // Add subtle chart pulse on price updates (every 10th update to avoid spam)
      if (Math.random() < 0.1) {
        const liveIndicator = document.querySelector('.live-indicator .pulse-dot');
        if (liveIndicator) {
          liveIndicator.classList.add('pulse-dot');
        }
      }
    }
  }

  updateTableDataOnly(): void {
    this.tableData = [...this.mt5LiveTrades, ];

    // Check for profit target achievement on live updates
    this.checkForProfitTargetCelebration();
  }

  updateTableData(): void {
    console.log('��� updateTableData called');
    console.log('������ Before update - tableData:', this.tableData ? this.tableData.length : 0);
    console.log('���� Before update - mt5LiveTrades:', this.mt5LiveTrades.length);

    // Get existing non-MT5 trades (those loaded from Firestore)
    const existingTrades = this.tableData ? this.tableData.filter(trade =>
      !this.mt5LiveTrades.some(mt5Trade => mt5Trade.position === trade.position)
    ) : [];

    console.log('📁 Existing non-MT5 trades:', existingTrades.length);

    // Create completely new array reference to trigger Angular change detection
    const previousLength = this.tableData ? this.tableData.length : 0;
    this.tableData = [...this.mt5LiveTrades, ...existingTrades];

    console.log('✅ After update - tableData:', this.tableData.length, 'trades');
    console.log('📈 Breakdown: MT5:', this.mt5LiveTrades.length, '+ Existing:', existingTrades.length);
    console.log('📊 Array reference changed:', previousLength !== this.tableData.length ? 'YES' : 'NO');
    console.log('🎯 Final tableData:', this.tableData);

    // Set metrics loading to false when table data is updated
    this.isLoadingMetrics = false;

    // Check for profit target achievement and celebrate! 🎉
    this.checkForProfitTargetCelebration();
  }

  // Update chart with real-time trade data
  updateChartWithNewTrade(newTrade: Table): void {
    console.log('📈 Updating chart with new trade data...', newTrade);

    // Add animation class temporarily
    const chartContainer = document.querySelector('.trading-chart-container');
    if (chartContainer) {
      chartContainer.classList.add('chart-loading');
      setTimeout(() => {
        chartContainer.classList.remove('chart-loading');
      }, 1000);
    }

    // Regenerate chart data with new trade included
    setTimeout(() => {
      this.generateTradingChartData();
    }, 300);
  }

  // Refresh chart when trades are closed
  updateChartWithClosedTrade(closedTrade: Table): void {
    console.log('📉 Updating chart with closed trade data...', closedTrade);

    // Add a subtle animation to show the chart is updating
    const chartContainer = document.querySelector('.trading-chart-container');
    if (chartContainer) {
      chartContainer.classList.add('chart-loading');
      setTimeout(() => {
        chartContainer.classList.remove('chart-loading');
      }, 800);
    }

    // Regenerate chart data
    setTimeout(() => {
      this.generateTradingChartData();
    }, 200);
  }

  // Toggle method for single notion data button
  toggleNotionData(): void {
    this.showNotionData = !this.showNotionData;
  }

  // Simple pagination methods
  getFilteredTableData(): Table[] {
    return this.tableData || [];
  }

  getDisplayedRows(): Table[] {
    const filtered = this.getFilteredTableData();
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    return filtered.slice(startIndex, endIndex);
  }

  getTotalPages(): number {
    const filtered = this.getFilteredTableData();
    return Math.ceil(filtered.length / this.pageSize);
  }

  setPage(page: number): void {
    if (page >= 1 && page <= this.getTotalPages()) {
      this.currentPage = page;
    }
  }

  isNewTrade(trade: Table): boolean {
    // Check if trade is recently added OR if it doesn't have a close date (live trade)
    const isRecent = this.recentlyAddedTrades.includes(trade);
    const isLiveTrade = !trade.closeDate || trade.closeDate === '' || trade.closeDate === '-' || trade.closeDate === 'N/A';
    return isRecent || isLiveTrade;
  }

  // Removed duplicate getSafeNumber method - using the implementation above

  getRiskPercentage(row: Table): string {
    // Calculate risk percentage based on actual account size
    const accountSize = this.mt5AccountInfo?.balance || this.calculateAccountSize() || 5000; // Fallback to 5k
    const riskAmount = this.getSafeNumber(row.riskPerTrade);

    if (riskAmount <= 0 || accountSize <= 0) {
      return '0.0';
    }

    const percentage = (riskAmount / accountSize) * 100;
    return percentage.toFixed(1);
  }

  getRRRPercentage(row: Table): string {
    // Calculate percentage gained based on R:R ratio and risk amount
    const rrr = row.rrr ? parseFloat(row.rrr.toString().replace('R', '')) : 0;
    const riskAmount = this.getSafeNumber(row.riskPerTrade);
    const accountSize = this.mt5AccountInfo?.balance || this.calculateAccountSize() || 5000; // Fallback to 5k

    if (rrr <= 0 || riskAmount <= 0 || accountSize <= 0) {
      return '0.0';
    }

    const gainAmount = rrr * riskAmount;
    const gainPercentage = (gainAmount / accountSize) * 100;
    return gainPercentage.toFixed(1);
  }

  getMURPercentage(row: Table): string {
    // Calculate MUR percentage based on actual account size
    const accountSize = this.mt5AccountInfo?.balance || this.calculateAccountSize() || 5000; // Fallback to 5k
    const murAmount = this.getSafeNumber(row.mfe);

    if (murAmount <= 0 || accountSize <= 0) {
      return '0.0';
    }

    const percentage = (murAmount / accountSize) * 100;
    return percentage.toFixed(1);
  }

  getNetPnLPercentage(row: Table): string {
    // Calculate Net P&L percentage based on actual account size
    const accountSize = this.mt5AccountInfo?.balance || this.calculateAccountSize() || 5000; // Fallback to 5k
    const netPnL = this.getSafeNumber(row.netProfit);

    if (accountSize <= 0) {
      return '0.0';
    }

    const percentage = (netPnL / accountSize) * 100;
    return percentage.toFixed(1);
  }

  addRowDirectlyToDataTable(newTrade: Table): void {
    try {
      console.log('🎯 Adding row directly to DataTable:', newTrade);

      if ($.fn.dataTable.isDataTable('#myTable')) {
        const table = $('#myTable').DataTable();

        // Create row data array matching the table structure
        const rowData = [
          newTrade.openDate,
          '', // Notion Trades column (complex, will be empty for direct insert)
          newTrade.status,
          newTrade.position,
          newTrade.symbol,
          newTrade.type,
          newTrade.volume,
          newTrade.entry,
          newTrade.sL,
          newTrade.tP,
          newTrade.closeDate,
          newTrade.exit,
          newTrade.commission,
          newTrade.swap,
          newTrade.profit,
          newTrade.netProfit
        ];

        // Add the row and redraw
        const rowNode = table.row.add(rowData).draw(false);
        console.log('✅ Row added directly to DataTable');

        // Scroll to top to show the new row
        $('#myTable_wrapper .dataTables_scrollBody').scrollTop(0);

      } else {
        console.log('⚠️ DataTable not initialized, cannot add row directly');
      }

    } catch (error) {
      console.error('❌ Error adding row directly to DataTable:', error);
    }
  }

  refreshDataTable(): void {
    try {
      console.log('🔄 Refreshing DataTable with', this.tableData.length, 'rows');
      console.log('📊 TableData contents:', this.tableData);

      // Use Angular binding refresh for complex columns
      this.refreshDataTableWithAngularBinding();

    } catch (error) {
      console.error('❌ Error refreshing DataTable:', error);
    }
  }

  forceDataTableRefresh(): void {
    console.log('💪 Force refreshing DataTable...');

    // Method 1: Immediate change detection
    this.cdr.detectChanges();

    // Method 2: Nuclear option - completely rebuild the table
    setTimeout(() => {
      this.nuclearDataTableRebuild();
    }, 100);
  }

  nuclearDataTableRebuild(): void {
    try {
      console.log('💥 Nuclear DataTable rebuild with', this.tableData.length, 'rows');

      // Step 1: Completely destroy existing DataTable
      if ($.fn.dataTable.isDataTable('#myTable')) {
        console.log('🗑��� Destroying existing DataTable completely');
        $('#myTable').DataTable().destroy();
        $('#myTable').empty(); // Clear all HTML content
      }

      // Step 2: Force Angular change detection
      this.cdr.detectChanges();

      // Step 3: Wait for DOM cleanup
      setTimeout(() => {
        // Step 4: Manually rebuild table HTML if needed
        console.log('🔨 Rebuilding table structure...');

        // Step 5: Reinitialize with fresh DataTable
        setTimeout(() => {
          console.log('🚀 Reinitializing DataTable from scratch');
          this.dtTrigger.next(null);

          // Step 6: If still no luck, try direct jQuery DataTable initialization
          setTimeout(() => {
            if (!$.fn.dataTable.isDataTable('#myTable') && this.tableData.length > 0) {
              console.log('🔧 Fallback: Direct jQuery DataTable initialization');
              $('#myTable').DataTable(this.dtOptions);
            }
          }, 300);
        }, 200);
      }, 100);

    } catch (error) {
      console.error('❌ Error in nuclear rebuild:', error);
      // Last resort fallback
      this.dtTrigger.next(null);
    }
  }

  // News Reminder Control Methods
  toggleReminderDetails(): void {
    this.showReminderDetails = !this.showReminderDetails;
  }

  getReminderStatus(): { total: number; scheduled: number } {
    return this.newsReminder.getReminderStatus();
  }

  getReminderStatusText(): string {
    const status = this.getReminderStatus();
    if (status.scheduled === 0) {
      return 'No active reminders - only current day news will have reminders';
    }
    return `${status.scheduled} active reminders for current day news`;
  }

  refreshNewsReminders(): void {
    console.log('🔄 Refreshing news reminders...');
    this.newsReminder.scheduleAllReminders(this.newsData);
  }

  clearAllReminders(): void {
    console.log('🧹 Clearing all news reminders...');
    this.newsReminder.clearAllReminders();
  }

  /**
   * Check if a specific news event has active reminders
   */
  isNewsReminderActive(newsEvent: any): boolean {
    return this.newsReminder.isNewsReminderActive(newsEvent);
  }

  /**
   * Check if a news event is for the current day
   */
  isCurrentDayNews(newsEvent: any): boolean {
    const today = new Date();
    const todayDay = today.getDay();

    // Check date string patterns
    if (newsEvent.date.includes('Today')) {
      return true;
    }

    // Parse the date and compare days
    try {
      const dateParts = newsEvent.date.trim().split(' ');
      if (dateParts.length >= 3) {
        const monthName = dateParts[1];
        const day = parseInt(dateParts[2]);
        const monthIndex = this.getMonthIndex(monthName);

        if (monthIndex !== -1) {
          const newsDate = new Date(today.getFullYear(), monthIndex, day);
          return newsDate.getDay() === todayDay;
        }
      }
    } catch (error) {
      console.warn('Error parsing news date:', error);
    }

    return false;
  }

  /**
   * Get month index from month name (helper method)
   */
  private getMonthIndex(monthName: string): number {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    return months.findIndex(month =>
      month.toLowerCase() === monthName.toLowerCase()
    );
  }

  // Trading settings handler methods
  onProfitTargetChange(): void {
    console.log('🎯 Profit target changed to:', this.profitTarget + '%');

    // Add visual feedback
    const dropdown = document.querySelector('.setting-dropdown') as HTMLElement;
    if (dropdown) {
      dropdown.classList.add('value-changed');
      setTimeout(() => dropdown.classList.remove('value-changed'), 600);
    }

    // Stop any existing celebration and reset tracking for new target
    this.confetti.stopCurrentCelebration();
    this.hasCelebratedCurrentTarget = false;
    this.lastCelebratedTarget = 0;

    this.updateTradingTargets();

    // Check if we should immediately celebrate the new target
    setTimeout(() => {
      this.checkForProfitTargetCelebration();
    }, 100);
  }

  // Test method to manually trigger confetti (for development/testing)
  testConfettiCelebration(): void {
    console.log('🧪 Testing confetti celebration manually...');
    // Stop any existing celebration first
    this.confetti.stopCurrentCelebration();
    // Start new celebration
    setTimeout(() => {
      this.confetti.celebrateProfitTarget(this.profitTarget);
    }, 100);
  }

  // Check for profit target achievement and trigger celebration
  private checkForProfitTargetCelebration(): void {
    const currentPercentageGain = this.calculateTotalPercentageGain();

    // Show celebration whenever we're at or above target
    if (currentPercentageGain >= this.profitTarget) {
      // Only trigger if we haven't celebrated this target yet
      if (!this.hasCelebratedCurrentTarget) {
        console.log('🎉 PROFIT TARGET REACHED! Triggering celebration...', {
          currentGain: currentPercentageGain,
          target: this.profitTarget
        });

        // Mark as celebrated to prevent multiple triggers
        this.hasCelebratedCurrentTarget = true;
        this.lastCelebratedTarget = this.profitTarget;

        // Trigger the amazing persistent confetti celebration!
        this.confetti.celebrateProfitTarget(this.profitTarget);

        // Optional: Also play sound for big wins (trades over $100 profit)
        const totalPnL = this.calculateTotalPnL();
        if (totalPnL >= 100) {
          this.playCelebrationSound();
        }
      }
    } else {
      // If we fall below target, stop celebration and reset flag
      if (this.hasCelebratedCurrentTarget) {
        console.log('📉 Below profit target, stopping celebration...');
        this.confetti.stopCurrentCelebration();
        this.hasCelebratedCurrentTarget = false;
      }
    }
  }

  // Helper method to play celebration sound
  private playCelebrationSound(): void {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
      oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
      oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); // G5

      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      console.warn('Could not play celebration sound:', error);
    }
  }

  onMaxLossChange(): void {
    console.log('🛑 Max loss changed to:', this.maxLoss + '%');

    // Add visual feedback
    const dropdowns = document.querySelectorAll('.setting-dropdown');
    const maxLossDropdown = dropdowns[1] as HTMLElement; // Second dropdown is max loss
    if (maxLossDropdown) {
      maxLossDropdown.classList.add('value-changed');
      setTimeout(() => maxLossDropdown.classList.remove('value-changed'), 600);
    }

    this.updateTradingTargets();
  }

  private updateTradingTargets(): void {
    // Update any chart reference lines or calculations based on new targets
    console.log('📊 Updating trading targets - Profit:', this.profitTarget + '%, Max Loss:', this.maxLoss + '%');

    // Trigger chart refresh to update profit target line
    this.generateTradingChartData();

    // Save to localStorage for persistence
    localStorage.setItem('tradingProfitTarget', this.profitTarget.toString());
    localStorage.setItem('tradingMaxLoss', this.maxLoss.toString());
  }



}
