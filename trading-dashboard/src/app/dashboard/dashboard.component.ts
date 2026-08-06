import { Component, OnDestroy, OnInit, ChangeDetectorRef, ChangeDetectionStrategy, Inject } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCardModule  } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { CommonModule, DOCUMENT, Location } from "@angular/common";
import { Router } from '@angular/router';
import { CalendarModule, CalendarEvent,CalendarMonthViewDay   } from 'angular-calendar';
import * as XLSX from 'xlsx';
import { Firestore, collection, addDoc, setDoc, doc,getDocs,onSnapshot   } from '@angular/fire/firestore';
import { addMonths, subMonths } from 'date-fns';
// DataTables removed to avoid heavy pre-bundling issues
// import { DataTablesModule  } from 'angular-datatables';
import { Subject } from 'rxjs';
// import * as DataTables from 'datatables.net';
// import 'datatables.net'; // Removed for build stability
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ReactiveFormsModule } from '@angular/forms';
import { MatNativeDateModule } from '@angular/material/core'; // for default JS Date support
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ConnectionStatusComponent } from '../connection-status/connection-status.component';
import { TradingCalendarComponent } from '../trading-calendar/trading-calendar.component';
import { DreamTimelineComponent } from '../dream-timeline/dream-timeline.component';
import { LiveRRTrackerComponent, LiveTradeSoundSettings as LiveTradeSoundSettingsModel } from '../live-rr-tracker/live-rr-tracker.component';
import { io, Socket } from "socket.io-client";
import { Chart, ChartConfiguration, ChartOptions, ChartType, registerables } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { ViewChild, ElementRef, AfterViewInit, HostListener, Renderer2 } from '@angular/core';
import { FcmService } from '../services/fcm.service';
import { NewsReminderService } from '../services/news-reminder.service';
import { ConfettiService } from '../services/confetti.service';
import { AuraEnergyService, AuraEnergyConfig, DEFAULT_AURA_ENERGY_CONFIG } from '../services/aura-energy.service';
import { Account, Certificate, Payout, PropFirm, RoiTransaction, SupabaseService, Trade, UserSettings } from '../services/supabase.service';
import { AuthService } from '../services/auth.service';
import { LiveTradeDisplayPreferences, ProfileSettingsComponent } from '../settings/profile-settings.component';
import { environment } from '../../../src/environments/environment';


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

interface LiveTradeSoundSettings {
  enabled: boolean;
  alertThreshold: number;
  highAlertThreshold: number;
  volume: number;
}

interface NewsReminderNotice {
  title: string;
  currencies: string;
  time: string;
  minutesBefore: number;
}

const DEFAULT_LIVE_TRADE_SOUND_SETTINGS: LiveTradeSoundSettings = {
  enabled: true,
  alertThreshold: 2.8,
  highAlertThreshold: 3.4,
  volume: 0.7
};

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
  mae?: string; // Maximum Adverse Excursion - tracks lowest unrealized profit
  screenshotUrl?: string;
  screenshotUrls?: string[];
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
  screenshotUrls: string[];
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ConnectionStatusComponent,
    TradingCalendarComponent,
    DreamTimelineComponent,
    LiveRRTrackerComponent,
    MatSlideToggleModule,
    MatCardModule,
    CommonModule,
    CalendarModule,
    // DataTablesModule,
    MatProgressBarModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    FormsModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    BaseChartDirective,
    ProfileSettingsComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss', './insights-additional.scss', './notion-performance.scss', './column-selector.scss', './trading-settings.scss', '../dream-timeline/dream-timeline-integration.scss', '../dream-timeline/dream-timeline-header.scss']
})


// @Injectable({ providedIn: 'root' })
export class DashboardComponent implements AfterViewInit {
  // Math object for template calculations
  Math = Math;
  environment = environment;
  isDashboardNavigationOpen = true;
  isNavigationDisplayMenuOpen = false;
  isAuraConfigModalOpen = false;
  isSavingAuraConfig = false;
  auraConfig: AuraEnergyConfig = { ...DEFAULT_AURA_ENERGY_CONFIG };
  isLiveTradeSoundSettingsOpen = false;
  liveTradeSoundSettings: LiveTradeSoundSettings = { ...DEFAULT_LIVE_TRADE_SOUND_SETTINGS };
  liveTradeSoundSettingsDraft: LiveTradeSoundSettings = { ...DEFAULT_LIVE_TRADE_SOUND_SETTINGS };
  liveTradeGaugePercentMax = 4;
  readonly auraConfigDefaults = DEFAULT_AURA_ENERGY_CONFIG;
  navigationDisplayMode: 'expanded' | 'collapsed' | 'hover' = 'expanded';
  private activeWorkspace = 'dashboard';
  roiTransactions: RoiTransaction[] = [];
  certificates: Certificate[] = [];
  certificatePayouts: Payout[] = [];
  isLoadingCertificates = false;
  isCertificateModalOpen = false;
  isPayoutModalOpen = false;
  isSavingCertificate = false;
  isDeletingCertificate = false;
  certificateDeleteConfirmationId: string | null = null;
  certificatePreviewUrls: Record<string, string> = {};
  certificateImageViewer: { url: string; alt: string } | null = null;
  payoutProofUrls: Record<string, string> = {};
  private certificateDeleteConfirmationTimer?: number;
  isSavingPayout = false;
  editingCertificateId: string | null = null;
  certificateFile: File | null = null;
  certificateForm: { account_id: string | null; program_name: string; passed_date: string; status: Certificate['status']; notes: string } = {
    account_id: null,
    program_name: '',
    passed_date: new Date().toISOString().slice(0, 10),
    status: 'passed',
    notes: ''
  };
  payoutForm: { certificate_id: string; amount: number | null; payout_date: string; notes: string; proof_url: string } = {
    certificate_id: '',
    amount: null,
    payout_date: new Date().toISOString().slice(0, 10),
    notes: '',
    proof_url: ''
  };
  isLoadingRoi = false;
  isSavingRoi = false;
  isDeletingRoi = false;
  editingRoiTransactionId: string | null = null;
  isRoiEntryModalOpen = false;
  roiFilter: 'all' | 'expense' | 'payout' = 'all';
  roiPage = 1;
  readonly roiPageSize = 5;
  roiReceiptFile: File | null = null;
  roiForm: { transaction_type: 'expense' | 'payout'; transaction_date: string; amount: number | null; note: string; account_id: string; image_url: string } = {
    transaction_type: 'expense',
    transaction_date: new Date().toISOString().slice(0, 10),
    amount: null,
    note: '',
    account_id: '',
    image_url: ''
  };

  toggleDashboardNavigation(): void {
    this.isDashboardNavigationOpen = !this.isDashboardNavigationOpen;
    this.navigationDisplayMode = this.isDashboardNavigationOpen ? 'expanded' : 'collapsed';
  }

  closeDashboardNavigation(): void {
    this.isDashboardNavigationOpen = false;
  }

  toggleNavigationDisplayMenu(): void {
    this.isNavigationDisplayMenuOpen = !this.isNavigationDisplayMenuOpen;
  }

  @HostListener('document:click', ['$event'])
  closeNavigationDisplayMenuOnOutsideClick(event: MouseEvent): void {
    const target = event.target as Element;
    if (!target.closest('.navigation-display-control')) {
      this.isNavigationDisplayMenuOpen = false;
    }
  }

  setNavigationDisplayMode(mode: 'expanded' | 'collapsed' | 'hover'): void {
    this.navigationDisplayMode = mode;
    this.isDashboardNavigationOpen = mode === 'expanded';
    this.isNavigationDisplayMenuOpen = false;
  }

  expandNavigationOnHover(): void {
    if (this.navigationDisplayMode === 'hover') {
      this.isDashboardNavigationOpen = true;
    }
  }

  collapseNavigationOnLeave(): void {
    if (this.navigationDisplayMode === 'hover') {
      this.isDashboardNavigationOpen = false;
    }
  }

  get currentWorkspace(): string {
    return this.activeWorkspace;
  }

  get isMainDashboard(): boolean {
    return this.currentWorkspace === 'dashboard';
  }

  navigateToWorkspace(workspace: 'dashboard' | 'accounts' | 'active-account' | 'notion-update' | 'trading-history' | 'roi' | 'payouts' | 'certificates'): void {
    this.closeProfileSettings();
    this.closeAccountRiskCalculator();
    this.activeWorkspace = workspace;
    this.location.go(workspace === 'dashboard' ? '/' : `/${workspace}`);
    if (workspace === 'roi' && !this.roiTransactions.length && !this.isLoadingRoi) {
      void this.loadRoiTransactions();
    }
    if (workspace === 'certificates' && !this.certificates.length && !this.isLoadingCertificates) {
      void this.loadCertificates();
    }

    if ((this.document.defaultView?.innerWidth ?? 0) <= 768) {
      this.closeDashboardNavigation();
    }
  }
  openProfileSettings(): void {
    this.isProfileSettingsOpen = true;
  }

  closeProfileSettings(): void {
    this.isProfileSettingsOpen = false;
  }

  async signOutFromDashboard(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }

  // Account Size Calculator
  accountSizeInput: number = 0;
  selectedAccountSize: number | null = null; // For account card selection
  dropdownSelectedSize: number = 2500; // Default dropdown to 2.5K (independent)
  showAccountSizeDropdown: boolean = false;
  showAccountRiskCalculator: boolean = false;
  selectedPercentage: number | null = null; // Track selected percentage button
  accountSizes = [
    { size: 5000, label: '5K' },
    { size: 10000, label: '10K' },
    { size: 25000, label: '25K' },
    { size: 50000, label: '50K' },
    { size: 100000, label: '100K' }
  ];

  accountSizesSecondary = [
    { size: 2500, label: '2.5K' },
    { size: 5000, label: '5K' },
    { size: 10000, label: '10K' },
    { size: 25000, label: '25K' },
    { size: 50000, label: '50K' },
    { size: 100000, label: '100K' }
  ];

  @ViewChild('accountSizeDropdownWrapper', { static: false }) accountSizeDropdownWrapper: ElementRef | undefined;
  private clickOutsideListener: (() => void) | null = null;

  selectAccountSize(size: number): void {
    this.selectedAccountSize = this.selectedAccountSize === size ? null : size;
    this.cdr.markForCheck();
  }

  toggleAccountSizeDropdown(): void {
    this.showAccountSizeDropdown = !this.showAccountSizeDropdown;
    this.cdr.markForCheck();
  }

  selectAccountSizeFromDropdown(size: number): void {
    this.dropdownSelectedSize = size; // Update dropdown only (independent)
    this.showAccountSizeDropdown = false;

    // If a percentage button is currently selected, recalculate the input
    if (this.selectedPercentage !== null) {
      this.accountSizeInput = (this.selectedPercentage / 100) * size;
    }

    this.cdr.markForCheck();
  }

  closeAccountSizeDropdown(): void {
    this.showAccountSizeDropdown = false;
    this.cdr.markForCheck();
  }

  openAccountRiskCalculator(): void {
    this.showAccountRiskCalculator = true;
  }

  closeAccountRiskCalculator(): void {
    this.showAccountRiskCalculator = false;
    this.showAccountSizeDropdown = false;
    this.cdr.markForCheck();
  }

  private setupClickOutsideListener(): void {
    this.clickOutsideListener = this.renderer.listen('document', 'click', (event: any) => {
      if (this.accountSizeDropdownWrapper && !this.accountSizeDropdownWrapper.nativeElement.contains(event.target)) {
        if (this.showAccountSizeDropdown) {
          this.closeAccountSizeDropdown();
        }
      }
    });
  }

  private removeClickOutsideListener(): void {
    if (this.clickOutsideListener) {
      this.clickOutsideListener();
      this.clickOutsideListener = null;
    }
  }

  getSelectedAccountSizeLabel(): string {
    const selected = this.accountSizesSecondary.find(size => size.size === this.dropdownSelectedSize);
    return selected?.label || 'Size';
  }

  setAccountSizeByPercentage(percentage: number): void {
    // Use dropdown selected size as the base for percentage calculations
    const baseAmount = this.dropdownSelectedSize || this.mt5AccountInfo?.startingBalance || 0;
    this.accountSizeInput = (percentage / 100) * baseAmount;
    this.selectedPercentage = percentage; // Track which percentage is selected
    this.cdr.markForCheck();
  }

  calculateAccountSizePercentages(): Array<{ size: number; label: string; percentage: number; displayValue: string }> {
    if (!this.accountSizeInput || this.accountSizeInput <= 0) {
      return this.accountSizes.map(acc => ({ size: acc.size, label: acc.label, percentage: 0, displayValue: '$0.00' }));
    }

    const currentBalance = this.mt5AccountInfo?.startingBalance || 0;
    if (currentBalance <= 0) {
      return this.accountSizes.map(acc => ({ size: acc.size, label: acc.label, percentage: 0, displayValue: '$0.00' }));
    }

    // Calculate percentage of current account
    const percentageOfCurrentAccount = (this.accountSizeInput / currentBalance) * 100;

    return this.accountSizes.map(acc => {
      // Calculate dollar value for this account size
      const dollarValue = (percentageOfCurrentAccount / 100) * acc.size;
      return {
        size: acc.size,
        label: acc.label,
        percentage: percentageOfCurrentAccount,
        displayValue: '$' + dollarValue.toFixed(2)
      };
    });
  }

  calculateAccountSizesSecondary(): Array<{ size: number; label: string; percentage: number; displayValue: string }> {
    // Use selected account size as reference, or return zeros if no input
    const referenceSize = this.selectedAccountSize || null;

    if (!this.accountSizeInput || this.accountSizeInput <= 0) {
      return this.accountSizesSecondary.map(acc => ({ size: acc.size, label: acc.label, percentage: 0, displayValue: '$0.00' }));
    }

    // If a reference size is selected, calculate based on that
    if (referenceSize && referenceSize > 0) {
      // Calculate what percentage the input represents of the selected account size
      const percentageOfSelectedAccount = (this.accountSizeInput / referenceSize) * 100;

      return this.accountSizesSecondary.map(acc => {
        // Apply that same percentage to each account size
        const dollarValue = (percentageOfSelectedAccount / 100) * acc.size;
        return {
          size: acc.size,
          label: acc.label,
          percentage: percentageOfSelectedAccount,
          displayValue: '$' + dollarValue.toFixed(2)
        };
      });
    }

    // Fallback: calculate based on starting balance (original behavior)
    const currentBalance = this.mt5AccountInfo?.startingBalance || 0;
    if (currentBalance <= 0) {
      return this.accountSizesSecondary.map(acc => ({ size: acc.size, label: acc.label, percentage: 0, displayValue: '$0.00' }));
    }

    // Calculate percentage of current account
    const percentageOfCurrentAccount = (this.accountSizeInput / currentBalance) * 100;

    return this.accountSizesSecondary.map(acc => {
      // Calculate dollar value for this account size
      const dollarValue = (percentageOfCurrentAccount / 100) * acc.size;
      return {
        size: acc.size,
        label: acc.label,
        percentage: percentageOfCurrentAccount,
        displayValue: '$' + dollarValue.toFixed(2)
      };
    });
  }

  // Daily Limit tracking
  dailyPnL: number = 0;
  dailyPnLPercent: number = 0;
  dailyWinsPercent: number = 0;
  dailyWinsAmount: number = 0;
  dailyLossesAmount: number = 0; // negative value for losses
  dailyLossesPercent: number = 0; // negative percent for losses
  dailyLimitUsed: number = 0;
  dailyLimitRemaining: number = 0;
  dailyLimitNotified: boolean = false;
  resetCountdown: string = '';

  // Daily Limit doughnut chart
  dailyLimitChartData: any = {
    labels: ['Used', 'Remaining'],
    datasets: [{ data: [0, 100], backgroundColor: ['#ef4444', '#fbbf24'], borderWidth: 0 }]
  };
  dailyLimitChartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } }
  };

  // Additional calculation methods for missing functions
  @ViewChild(BaseChartDirective) chart?: BaseChartDirective;
  viewDate: Date = new Date();
  events: CalendarEvent[] = [];
  locale: string = 'en';
  rawData: any[] = [];
  // Active Account Table
  tableData: Table[] = []; // Initialize as empty array
  mt5ImportedTrades: Table[] = [];
  mt5SyncAccountId = '';
  accounts: Account[] = [];
  propFirms: PropFirm[] = [
    { id: 'the5ers', name: 'The5ers' },
    { id: 'ftmo', name: 'FTMO' },
    { id: 'funding-pips', name: 'Funding Pips' },
    { id: 'funded-next', name: 'FundedNext' }
  ];
  selectedAccount: Account | null = null;
  selectedFirm: string | null = null;
  private readonly selectedAccountStorageKey = 'trading-dashboard.selected-account-id';
  private readonly liveTradeSoundSettingsStorageKey = 'trading-dashboard.live-trade-sound-settings';
  private readonly liveTradeDisplayPreferencesStorageKey = 'trading-dashboard.live-trade-display-preferences';
  private readonly liveExtremesStorageKey = 'trading-dashboard.live-trade-extremes.v2';
  private readonly tradeScreenshotStorageKey = 'trading-dashboard.trade-screenshots.v1';
  private readonly legacyLiveExtremesStorageKey = 'trading-dashboard.live-trade-extremes';
  private readonly gaugeAlertSoundUrl = '/assets/sounds/trade-alert.flac';
  private readonly highGaugeAlertSoundUrl = '/assets/sounds/trade-alert-high.wav';
  private readonly newsReminderSoundUrl = '/assets/sounds/news-alert.wav';
  private readonly gaugeAlertNotifiedTickets = new Set<string>();
  private readonly gaugeAlertSounds = new Map<string, HTMLAudioElement>();
  private readonly highGaugeAlertSounds = new Map<string, HTMLAudioElement>();
  private readonly activeGaugeAlertLevels = new Map<string, 'normal' | 'high'>();
  private readonly screenshotLoadErrors = new Set<string>();
  private liveExtremesCacheTimer?: number;
  editingAccountId: string | null = null;
  isCreatingAccount = false;
  accountPage = 1;
  readonly accountPageSize = 5;
  isSavingAccount = false;
  isDeletingAccount = false;
  newsReminderNotice: NewsReminderNotice | null = null;
  private newsReminderAudio?: HTMLAudioElement;
  accountEditForm: Partial<Account> = {};
  accountPendingDeletion: Account | null = null;
  isLoadingAccounts = true;

  get firms(): { name: string; accountCount: number }[] {
    const accountCounts = new Map<string, number>();
    for (const account of this.accounts) {
      const firm = this.getFirmName(account);
      accountCounts.set(firm, (accountCounts.get(firm) ?? 0) + 1);
    }
    return Array.from(new Set([
      ...this.propFirms.map(firm => firm.name),
      ...accountCounts.keys()
    ])).map(name => ({ name, accountCount: accountCounts.get(name) ?? 0 }));
  }

  get firmOptions(): PropFirm[] {
    return this.propFirms;
  }

  private getFirmName(account: Account): string {
    return this.propFirms.find(firm => firm.id === account.prop_firm_id)?.name || 'Independent accounts';
  }

  get filteredAccounts(): Account[] {
    return this.selectedFirm
      ? this.accounts.filter(account => this.getFirmName(account) === this.selectedFirm)
      : [];
  }

  get hasFixTicketMatches(): boolean {
    return this.fixTicketRows.some(row => row.matched);
  }

  get hasFixTicketPatchableRows(): boolean {
    return this.hasFixTicketMatches || Object.values(this.fixTicketManualTickets).some(ticket => ticket.trim().length > 0);
  }

  get syncAccounts(): Account[] {
    return [...this.accounts].sort((left, right) => {
      const leftDate = left.start_date ? Date.parse(left.start_date) : Number.POSITIVE_INFINITY;
      const rightDate = right.start_date ? Date.parse(right.start_date) : Number.POSITIVE_INFINITY;
      const leftSortDate = Number.isNaN(leftDate) ? Number.POSITIVE_INFINITY : leftDate;
      const rightSortDate = Number.isNaN(rightDate) ? Number.POSITIVE_INFINITY : rightDate;

      return leftSortDate - rightSortDate || left.name.localeCompare(right.name);
    });
  }

  get pagedAccounts(): Account[] {
    const startIndex = (this.accountPage - 1) * this.accountPageSize;
    return this.filteredAccounts.slice(startIndex, startIndex + this.accountPageSize);
  }

  get accountTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredAccounts.length / this.accountPageSize));
  }

  get accountPageNumbers(): (number | string)[] {
    const totalPages = this.accountTotalPages;
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    if (this.accountPage <= 3) return [1, 2, 3, '…', totalPages];
    if (this.accountPage >= totalPages - 2) return [1, '…', totalPages - 2, totalPages - 1, totalPages];
    return [1, '…', this.accountPage, '…', totalPages];
  }

  setAccountPage(page: number): void {
    if (page >= 1 && page <= this.accountTotalPages) {
      this.accountPage = page;
      this.cdr.markForCheck();
    }
  }

  selectFirm(firm: string): void {
    this.selectedFirm = firm;
    this.accountPage = 1;
    this.cancelAccountEdit();
    this.cdr.markForCheck();
  }

  openAccountCreator(): void {
    this.isCreatingAccount = true;
    this.editingAccountId = null;
    this.accountEditForm = {
      name: '',
      prop_firm_id: this.propFirms.find(firm => firm.name === this.selectedFirm)?.id || null,
      account_number: '',
      initial_balance: null,
      profit_target_percent: null,
      max_total_drawdown_percent: null,
      daily_loss_limit_percent: null,
      start_date: new Date().toISOString().slice(0, 10),
      status: 'active',
      phase: 'phase1'
    };
    this.cdr.markForCheck();
  }

  editAccount(account: Account): void {
    this.isCreatingAccount = false;
    this.editingAccountId = account.id;
    this.accountEditForm = {
      name: account.name,
      prop_firm_id: account.prop_firm_id ?? null,
      account_number: account.account_number ?? '',
      initial_balance: account.initial_balance ?? this.inferAccountSize(account),
      profit_target_percent: account.profit_target_percent ?? 0,
      max_total_drawdown_percent: account.max_total_drawdown_percent ?? 0,
      daily_loss_limit_percent: account.daily_loss_limit_percent ?? 0,
      start_date: account.start_date ?? '',
      status: account.status ?? 'active',
      phase: account.phase ?? 'phase1'
    };
    this.cdr.markForCheck();
  }

  cancelAccountEdit(): void {
    this.editingAccountId = null;
    this.isCreatingAccount = false;
    this.accountEditForm = {};
    this.isSavingAccount = false;
  }

  requestAccountDeletion(account: Account): void {
    if (this.isDeletingAccount) return;
    this.accountPendingDeletion = account;
    this.cdr.markForCheck();
  }

  cancelAccountDeletion(): void {
    if (this.isDeletingAccount) return;
    this.accountPendingDeletion = null;
    this.cdr.markForCheck();
  }

  async confirmAccountDeletion(): Promise<void> {
    const account = this.accountPendingDeletion;
    if (!account || this.isDeletingAccount) return;

    this.isDeletingAccount = true;
    try {
      await this.supabaseService.deleteAccount(account.id);
      this.accounts = this.accounts.filter(item => item.id !== account.id);

      if (this.selectedAccount?.id === account.id) {
        this.selectedAccount = this.accounts[0] ?? null;
        if (this.selectedAccount) {
          localStorage.setItem(this.selectedAccountStorageKey, this.selectedAccount.id);
          this.selectedFirm = this.getFirmName(this.selectedAccount);
        } else {
          localStorage.removeItem(this.selectedAccountStorageKey);
          this.selectedFirm = null;
        }
        this.applySelectedAccountSettings();
        await this.loadMT5Data();
      }

      if (this.selectedFirm && !this.firms.some(firm => firm.name === this.selectedFirm)) {
        this.selectedFirm = this.firms[0]?.name ?? null;
        this.accountPage = 1;
      }
      this.accountPendingDeletion = null;
      this.snackBar.open(`${account.name} deleted.`, 'Dismiss', { duration: 3000, verticalPosition: 'top', horizontalPosition: 'right', panelClass: ['account-notification', 'notification-success'] });
    } catch (error) {
      console.error('Unable to delete account:', error);
      this.snackBar.open(error instanceof Error ? error.message : 'Unable to delete account.', 'Dismiss', { duration: 5000, verticalPosition: 'top', horizontalPosition: 'right', panelClass: ['account-notification', 'notification-error'] });
    } finally {
      this.isDeletingAccount = false;
      this.cdr.markForCheck();
    }
  }

  async saveAccountEdit(): Promise<void> {
    if (!this.accountEditForm.name?.trim()) return;

    this.isSavingAccount = true;
    const accountData = {
      name: this.accountEditForm.name.trim(),
      prop_firm_id: this.accountEditForm.prop_firm_id || null,
      account_number: this.accountEditForm.account_number?.trim() || null,
      initial_balance: Number(this.accountEditForm.initial_balance) || 0,
      profit_target_percent: Number(this.accountEditForm.profit_target_percent) || 0,
      max_total_drawdown_percent: Number(this.accountEditForm.max_total_drawdown_percent) || 0,
      daily_loss_limit_percent: Number(this.accountEditForm.daily_loss_limit_percent) || 0,
      start_date: this.accountEditForm.start_date || null,
      status: this.accountEditForm.status || 'active',
      phase: this.accountEditForm.phase || 'phase1'
    };

    try {
      if (this.isCreatingAccount) {
        const createdAccount = await this.supabaseService.createAccount(accountData);
        this.accounts = [createdAccount, ...this.accounts];
        this.selectedAccount = createdAccount;
        localStorage.setItem(this.selectedAccountStorageKey, createdAccount.id);
        this.selectedFirm = this.getFirmName(createdAccount);
        this.accountPage = 1;
        this.applySelectedAccountSettings();
        await this.loadMT5Data();
        this.cancelAccountEdit();
        this.snackBar.open(`${createdAccount.name} added and set active.`, 'Dismiss', { duration: 3000, verticalPosition: 'top', horizontalPosition: 'right', panelClass: ['account-notification', 'notification-success'] });
      } else if (this.editingAccountId) {
        const updatedAccount = await this.supabaseService.updateAccount(this.editingAccountId, accountData);
        this.accounts = this.accounts.map(account => account.id === updatedAccount.id ? updatedAccount : account);
        if (this.selectedAccount?.id === updatedAccount.id) {
          this.selectedAccount = updatedAccount;
          this.applySelectedAccountSettings();
        }
        this.cancelAccountEdit();
        this.snackBar.open('Account details saved.', 'Dismiss', { duration: 3000, verticalPosition: 'top', horizontalPosition: 'right', panelClass: ['account-notification', 'notification-success'] });
      }
    } catch (error) {
      console.error(`Unable to ${this.isCreatingAccount ? 'create' : 'update'} account:`, error);
      this.snackBar.open(error instanceof Error ? error.message : `Unable to ${this.isCreatingAccount ? 'add' : 'save'} account.`, 'Dismiss', { duration: 5000, verticalPosition: 'top', horizontalPosition: 'right', panelClass: ['account-notification', 'notification-error'] });
    } finally {
      this.isSavingAccount = false;
      this.cdr.markForCheck();
    }
  }

  isMostRecentAccount(account: Account): boolean {
    return this.accounts[0]?.id === account.id;
  }
  dtOptions: any = {}; // Use 'any' or type the object more specifically later
  dtTrigger: Subject<any> = new Subject<any>();

  // MT5 Live Trading properties
mt5AccountInfo: AccountSettings = {
  startingBalance: 2500,
  balance: 0,
  profitTarget: 0,
  maxTotalDrawdown: 0,
  dailyLossLimit: 0
};
  mt5LiveTrades: Table[] = []; // Live trades from MT5
  private mt5OpenPositionIds: Set<string> | null = null;
  private mt5AccountLogin: string | null = null;
  private mt5DataLoadVersion = 0;
  isLoadingMT5Data = false;
  isSyncingMT5Trades = false;
  mt5ImportMessage = '';
  mt5ImportError = '';
  mt5SyncStatus: 'idle' | 'syncing' | 'success' | 'error' = 'idle';
  mt5SyncStatusMessage = '';
  fixTicketAccountId = '';
  fixTicketFileName = '';
  fixTicketRows: { openTime: string; adjustedOpenTime: string; ticket: string; matched: boolean; matchedTradeId?: string }[] = [];
  fixTicketDbRows: Trade[] = [];
  fixTicketManualTickets: Record<string, string> = {};
  fixTicketComparisonVisible = false;
  isFixingTradeTickets = false;
  fixTicketStatus: 'idle' | 'ready' | 'fixing' | 'success' | 'error' = 'idle';
  fixTicketStatusMessage = '';
  fixTicketProgress = 0;
  mt5SyncProgress = 0;
  mt5SyncProcessed = 0;
  mt5SyncTotal = 0;
  mt5SyncCreated = 0;
  mt5SyncUpdated = 0;
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

  onChartModeChanged(mode: string): void {
    this.isDailyChart = mode === 'daily';
    this.generateTradingChartData();
  }

  toggleChartMode(): void {
    const next = this.isDailyChart ? 'trades' : 'daily';
    this.onChartModeChanged(next);
  }

  onSlideModeChanged(checked: boolean): void {
    this.onChartModeChanged(checked ? 'daily' : 'trades');
  }

  getPerformanceBarHeight(value: number, bestProfit: number, worstLossAbs: number): number {
    const maxVal = Math.max(Math.abs(bestProfit) || 0, Math.abs(worstLossAbs) || 0);
    if (!value || maxVal === 0) return 0;
    const ratio = Math.abs(value) / maxVal;
    const pct = ratio * 100;
    return Math.max(10, Math.min(100, Math.round(pct)));
  }

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
  // private BACKEND_URL = 'http://localhost:3000'; // This will be overridden in cloud environments
     private BACKEND_URL_NOTION = environment.backendUrlNotion;
     private BACKEND_URL_MT5 = environment.backendUrlMt5;

  // Confetti celebration tracking
  private lastCelebratedTarget: number = 0;
  private hasCelebratedCurrentTarget: boolean = false;

  // Chart configuration for beautiful trading visualization
  public chartType: ChartType = 'line';
  public chartLabels: string[] = [];
  public isDailyChart: boolean = false;
  public chartData: any = {
    labels: [],
    datasets: [
      {
        label: 'Account Balance',
        data: [],
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderWidth: 4,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: 'rgb(16, 185, 129)',
        pointBorderColor: 'transparent',
        pointBorderWidth: 0,
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
        display: false,
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
                   legendItem.text.startsWith('Daily Limit') ||
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
          label: (context: any) => {
            const value = context.parsed.y;
            const index = context.dataIndex;
            const data = context.dataset.data;
            const changeLabel = this.isDailyChart ? 'Day P&L' : 'Trade P&L';

            if (index === 0) {
              return `Starting Balance: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            } else {
              const previousValue = data[index - 1];
              const change = value - previousValue;
              const changeText = change >= 0 ? `+$${change.toFixed(2)}` : `-$${Math.abs(change).toFixed(2)}`;
              return [
                `Balance: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                `${changeLabel}: ${changeText}`
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
        min: this.mt5AccountInfo.startingBalance * 0.9,
        max: this.mt5AccountInfo.startingBalance * 1.1,
        grid: {
          display: true,
          color: 'rgba(0, 0, 0, 0.08)',
          lineWidth: 1
        },
        ticks: {
          // maxTicksLimit: 15,
          font: {
            size: 15,
            weight: 'normal'
          },
          color: '#64748b',
          stepSize: 50,
          // callback: (value: string | number) => {
          //   const v = Number(value);
          //   const sign = v > 0 ? '+' : '';
          //   return `${sign}${v}%`;
          // }
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



  isDarkTheme = false;
  isProfileSettingsOpen = false;
  profileDisplayName = 'Trader';
  profileAvatarUrl = '';

  get profileInitials(): string {
    return this.profileDisplayName.split(/\s+/).filter(Boolean).slice(0, 2).map(name => name[0]).join('').toUpperCase() || 'T';
  }

  constructor(private firestore: Firestore, private fcm: FcmService, private http: HttpClient, private cdr: ChangeDetectorRef,
    private newsReminder: NewsReminderService, private confetti: ConfettiService, private renderer: Renderer2, private snackBar: MatSnackBar,
    private supabaseService: SupabaseService, private auth: AuthService, private router: Router, private location: Location, private auraEnergy: AuraEnergyService, @Inject(DOCUMENT) private document: Document) {
    this.activeWorkspace = this.router.url.split('?')[0].replace('/', '') || 'dashboard';
    this.isProfileSettingsOpen = this.router.url.split('?')[0] === '/settings';
    if ((this.document.defaultView?.innerWidth ?? 0) <= 768) {
      this.isDashboardNavigationOpen = false;
      this.navigationDisplayMode = 'collapsed';
    }
    this.isDarkTheme = this.document.defaultView?.localStorage.getItem('dashboard-theme') === 'dark';
    this.loadLiveTradeSoundSettings();
    this.applyTheme();

    // Register Chart.js components
    Chart.register(...registerables);
  }

  openLiveTradeSoundSettings(): void {
    this.liveTradeSoundSettingsDraft = { ...this.liveTradeSoundSettings };
    this.isLiveTradeSoundSettingsOpen = true;
  }

  closeLiveTradeSoundSettings(): void {
    this.isLiveTradeSoundSettingsOpen = false;
  }

  onLiveTradeSoundSettingsChange(settings: LiveTradeSoundSettingsModel): void {
    this.liveTradeSoundSettings = { ...settings };
    this.document.defaultView?.localStorage.setItem(this.liveTradeSoundSettingsStorageKey, JSON.stringify(this.liveTradeSoundSettings));
    this.saveLiveTradeDisplayPreferences();
    this.stopAllGaugeAlerts();
    this.cdr.markForCheck();
  }

  onLiveTradeDisplayPreferencesChange(preferences: LiveTradeDisplayPreferences): void {
    this.liveTradeGaugePercentMax = preferences.positiveGaugePercentMax;
    this.onLiveTradeSoundSettingsChange({
      enabled: preferences.soundEnabled,
      alertThreshold: preferences.soundThreshold,
      highAlertThreshold: preferences.highPrioritySoundThreshold,
      volume: this.liveTradeSoundSettings.volume
    });
  }

  onLiveTradeGaugePercentMaxChange(value: number): void {
    this.liveTradeGaugePercentMax = value;
    this.saveLiveTradeDisplayPreferences();
  }

  private saveLiveTradeDisplayPreferences(): void {
    this.document.defaultView?.localStorage.setItem(this.liveTradeDisplayPreferencesStorageKey, JSON.stringify({
      positiveGaugePercentMax: this.liveTradeGaugePercentMax,
      soundEnabled: this.liveTradeSoundSettings.enabled,
      soundThreshold: this.liveTradeSoundSettings.alertThreshold,
      highPrioritySoundThreshold: this.liveTradeSoundSettings.highAlertThreshold
    }));
  }

  saveLiveTradeSoundSettings(): void {
    const settings = this.liveTradeSoundSettingsDraft;
    if (settings.alertThreshold < 0 || settings.highAlertThreshold <= settings.alertThreshold || settings.volume < 0 || settings.volume > 1) {
      this.snackBar.open('Set a valid alert range and volume.', 'Dismiss', { duration: 4000 });
      return;
    }

    this.liveTradeSoundSettings = { ...settings };
    this.document.defaultView?.localStorage.setItem(this.liveTradeSoundSettingsStorageKey, JSON.stringify(this.liveTradeSoundSettings));
    this.saveLiveTradeDisplayPreferences();
    for (const trade of this.mt5LiveTrades) {
      this.notifyGaugePercentage(trade);
    }
    this.closeLiveTradeSoundSettings();
    this.snackBar.open('Live trade sound settings saved.', 'Dismiss', { duration: 3000 });
    this.cdr.markForCheck();
  }

  testLiveTradeSound(): void {
    if (!this.liveTradeSoundSettingsDraft.enabled) return;
    const sound = new Audio(this.gaugeAlertSoundUrl);
    sound.volume = this.liveTradeSoundSettingsDraft.volume;
    sound.play().catch(() => this.snackBar.open('Your browser blocked the sound preview.', 'Dismiss', { duration: 4000 }));
  }

  private loadLiveTradeSoundSettings(): void {
    try {
      const saved = this.document.defaultView?.localStorage.getItem(this.liveTradeSoundSettingsStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<LiveTradeSoundSettings>;
      const settings = { ...DEFAULT_LIVE_TRADE_SOUND_SETTINGS, ...parsed };
      if (settings.alertThreshold >= 0 && settings.highAlertThreshold > settings.alertThreshold && settings.volume >= 0 && settings.volume <= 1) {
        this.liveTradeSoundSettings = settings;
      }
    } catch {
      this.liveTradeSoundSettings = { ...DEFAULT_LIVE_TRADE_SOUND_SETTINGS };
    }
  }

  openAuraConfigModal(): void {
    this.auraConfig = this.auraEnergy.getConfig();
    this.isAuraConfigModalOpen = true;
    this.cdr.markForCheck();
  }

  closeAuraConfigModal(): void {
    this.isAuraConfigModalOpen = false;
    this.cdr.markForCheck();
  }

  async applyAuraConfig(): Promise<void> {
    if (this.auraConfig.maxDelayMs < this.auraConfig.minDelayMs || this.auraConfig.maxTargets < this.auraConfig.minTargets) {
      this.snackBar.open('Maximum values must be at least their corresponding minimums.', 'Dismiss', { duration: 4000 });
      return;
    }

    this.isSavingAuraConfig = true;
    this.cdr.markForCheck();
    try {
      this.auraEnergy.updateConfig(this.auraConfig);
      this.auraConfig = await this.auraEnergy.saveConfig();
      this.snackBar.open('AURA energy settings saved.', 'Dismiss', { duration: 3000 });
      this.closeAuraConfigModal();
    } catch (error) {
      console.error('Unable to save AURA energy settings:', error);
      this.snackBar.open('Unable to save AURA energy settings.', 'Dismiss', { duration: 4000 });
    } finally {
      this.isSavingAuraConfig = false;
      this.cdr.markForCheck();
    }
  }

  async resetAuraConfig(): Promise<void> {
    this.isSavingAuraConfig = true;
    this.cdr.markForCheck();
    try {
      this.auraEnergy.updateConfig(DEFAULT_AURA_ENERGY_CONFIG);
      this.auraConfig = await this.auraEnergy.saveConfig();
      this.snackBar.open('AURA energy settings reset.', 'Dismiss', { duration: 3000 });
    } catch (error) {
      console.error('Unable to reset AURA energy settings:', error);
      this.snackBar.open('Unable to reset AURA energy settings.', 'Dismiss', { duration: 4000 });
    } finally {
      this.isSavingAuraConfig = false;
      this.cdr.markForCheck();
    }
  }

  onAuraConfigEnabledChange(checked: boolean): void {
    this.auraConfig.enabled = checked;
    this.auraEnergy.updateConfig({ enabled: checked });
  }

  toggleTheme(): void {
    this.isDarkTheme = !this.isDarkTheme;
    this.applyTheme();
    this.document.defaultView?.localStorage.setItem('dashboard-theme', this.isDarkTheme ? 'dark' : 'light');
  }

  private applyTheme(): void {
    this.renderer[this.isDarkTheme ? 'addClass' : 'removeClass'](this.document.body, 'dark-theme');
    this.updateChartTheme();
  }

  private updateChartTheme(): void {
    const textColor = this.isDarkTheme ? '#C4B5FD' : '#64748b';
    const gridColor = this.isDarkTheme ? 'rgba(167, 139, 250, 0.18)' : 'rgba(0, 0, 0, 0.08)';
    const chartOptions = this.chartOptions as any;

    this.chartOptions = {
      ...chartOptions,
      plugins: {
        ...chartOptions.plugins,
        legend: {
          ...chartOptions.plugins.legend,
          labels: { ...chartOptions.plugins.legend.labels, color: textColor }
        }
      },
      scales: {
        ...chartOptions.scales,
        x: {
          ...chartOptions.scales.x,
          grid: { ...chartOptions.scales.x.grid, color: gridColor },
          ticks: { ...chartOptions.scales.x.ticks, color: textColor }
        },
        y: {
          ...chartOptions.scales.y,
          grid: { ...chartOptions.scales.y.grid, color: gridColor },
          ticks: { ...chartOptions.scales.y.ticks, color: textColor },
          title: { ...chartOptions.scales.y.title, color: textColor }
        }
      }
    };
  }

  startReconnect(): void {
    void this.loadMT5Data();
  }
  
  private getPhilippinesNow(): Date {
    // Philippines is UTC+8, no DST
    const nowUtc = new Date();
    return new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000);
  }

  private getCurrentSessionStart(): Date {
    const phtNow = this.getPhilippinesNow();
    const sessionStart = new Date(phtNow);
    sessionStart.setHours(15, 0, 0, 0); // 3:00 PM PHT
    // If current time is before 3 PM, use yesterday 3 PM
    if (phtNow.getTime() < sessionStart.getTime()) {
      sessionStart.setDate(sessionStart.getDate() - 1);
    }
    // Convert back to UTC timestamp
    return new Date(sessionStart.getTime() - 8 * 60 * 60 * 1000);
  }

  private parseOpenDate(str: string): Date | null {
    // Accept multiple formats, including:
    // - "MM.DD.YYYY HH:mm[:ss]"
    // - "YYYY.MM.DD HH:mm[:ss]"
    // - Natural strings like "Sep 19, 2025, 08:21 PM"
    if (!str) return null;
    const raw = str.trim();

    // Try native parser first for flexible formats (e.g., with month names and AM/PM)
    const native = new Date(raw);
    if (!isNaN(native.getTime())) return native;

    // Fallback to dot-separated formats
    const parts = raw.split(' ');
    if (parts.length < 1) return null;
    const datePart = parts[0];
    const timePart = parts[1] || '00:00:00';

    let y = 0, m = 0, d = 0, hh = 0, mm = 0, ss = 0;
    if (datePart.includes('.')) {
      const dp = datePart.split('.').map(v => parseInt(v, 10));
      if (dp.length === 3 && dp[0] > 1900) { // YYYY.MM.DD
        y = dp[0]; m = dp[1] - 1; d = dp[2];
      } else if (dp.length === 3) { // MM.DD.YYYY
        m = dp[0] - 1; d = dp[1]; y = dp[2];
      }
    }

    const tp = timePart.split(':').map(v => parseInt(v, 10));
    if (tp.length >= 2) { hh = tp[0]; mm = tp[1]; ss = tp.length >= 3 ? tp[2] : 0; }

    const dt = new Date(y, m, d, hh, mm, ss);
    return isNaN(dt.getTime()) ? null : dt;
  }

  private updateResetCountdown(): void {
    const phtNow = this.getPhilippinesNow();
    const target = new Date(phtNow.getTime());
    // Use UTC setters so the UTC fields represent PHT local time (since we shifted by +8h)
    target.setUTCHours(15, 0, 0, 0); // 3:00 PM PHT
    if (phtNow.getTime() >= target.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    let diff = target.getTime() - phtNow.getTime();
    if (diff < 0) diff = 0;
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    this.resetCountdown = `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }

  private getSessionWindowUtc(): { start: Date, end: Date } {
    const phtNow = this.getPhilippinesNow();
    const today3pmPHT = new Date(phtNow.getTime());
    today3pmPHT.setHours(15, 0, 0, 0);
    const windowStartPHT = new Date(today3pmPHT.getTime() - 24 * 60 * 60 * 1000); // yesterday 3 PM PHT
    const windowEndPHT = new Date(Math.min(today3pmPHT.getTime(), phtNow.getTime())); // up to 3 PM today (or now if before 3 PM)
    return {
      start: new Date(windowStartPHT.getTime() - 8 * 60 * 60 * 1000),
      end: new Date(windowEndPHT.getTime() - 8 * 60 * 60 * 1000)
    };
  }

  private getTodayWindowUtc(): { start: Date, end: Date } {
    const phtNow = this.getPhilippinesNow();
    const startPHT = new Date(phtNow.getTime());
    startPHT.setHours(0, 0, 0, 0); // midnight today PHT
    return {
      start: new Date(startPHT.getTime() - 8 * 60 * 60 * 1000),
      end: new Date(phtNow.getTime() - 8 * 60 * 60 * 1000) // up to now
    };
  }

  private updateDailyLimitMetrics(): void {
    const { start: windowStartUTC, end: windowEndUTC } = this.getSessionWindowUtc();

    let pnl = 0;
    let winSum = 0;
    let lossSum = 0; // keep negative
    for (const t of this.tableData) {
      const od = this.parseOpenDate(t.openDate || '');
      const status = String(t.mt5status || '').toLowerCase();
      const isOpenPosition = status === 'open' || status === 'live' || status === 'position' || t.closeDate === '-';
      const isInSession = od && od.getTime() >= windowStartUTC.getTime() && od.getTime() <= windowEndUTC.getTime();
      if (isOpenPosition || isInSession) {
        const p = this.getSafeNumber(t.netProfit);
        pnl += p;
        if (p > 0) winSum += p;
        else if (p < 0) lossSum += p;
      }
    }

    this.dailyPnL = pnl;
    const startBal = this.mt5AccountInfo?.startingBalance || 0;
    this.dailyPnLPercent = startBal > 0 ? (pnl / startBal) * 100 : 0;
    this.dailyWinsAmount = winSum;
    this.dailyWinsPercent = startBal > 0 ? (winSum / startBal) * 100 : 0;
    this.dailyLossesAmount = lossSum; // negative value
    this.dailyLossesPercent = startBal > 0 ? (lossSum / startBal) * 100 : 0;

    const limitPct = this.mt5AccountInfo?.dailyLossLimit || 3.5; // use configured limit, default 3.5
    const limitAmt = startBal * (limitPct / 100);
    const used = Math.min(limitAmt, Math.max(0, -pnl)); // only losses eat the limit
    const remaining = Math.max(0, limitAmt - used);
    this.dailyLimitUsed = used;
    this.dailyLimitRemaining = remaining;

    // Update chart (represent as percentage of limit)
    const usedPct = limitAmt > 0 ? (used / limitAmt) * 100 : 0;
    const remPct = Math.max(0, 100 - usedPct);
    this.dailyLimitChartData = {
      labels: ['Used', 'Remaining'],
      datasets: [{ data: [Number(usedPct.toFixed(2)), Number(remPct.toFixed(2))], backgroundColor: ['#ef4444', '#fbbf24'], borderWidth: 0 }]
    };

    // Notify at -3.5%
    if (this.dailyPnLPercent <= -3.5 && !this.dailyLimitNotified) {
      this.dailyLimitNotified = true;
      this.sendNotif('', 'Daily Limit Alert', `You have reached -3.5% today. Current: ${this.dailyPnLPercent.toFixed(2)}%`);
    }
  }

  calculateSessionWinRate(): number {
    const { start, end } = this.getSessionWindowUtc();
    const trades = this.tableData.filter(t => {
      const od = this.parseOpenDate(t.openDate || '');
      return od && od.getTime() >= start.getTime() && od.getTime() <= end.getTime();
    });
    const totalTrades = trades.length;
    if (totalTrades === 0) return 0;
    const wins = trades.filter(t => this.getSafeNumber(t.netProfit) > 0).length;
    return Math.round((wins / totalTrades) * 100);
  }

  calculateTodayWinRate(): number {
    const { start, end } = this.getTodayWindowUtc();
    const trades = this.tableData.filter(t => {
      const od = this.parseOpenDate(t.openDate || '');
      return od && od.getTime() >= start.getTime() && od.getTime() <= end.getTime();
    });
    const totalTrades = trades.length;
    if (totalTrades === 0) return 0;
    const wins = trades.filter(t => this.getSafeNumber(t.netProfit) > 0).length;
    return Math.round((wins / totalTrades) * 100);
  }

  getWinRingCircumference(): number { return 2 * Math.PI * 44; }
  getWinRingDash(): string {
    const c = this.getWinRingCircumference();
    const limitPct = this.mt5AccountInfo?.dailyLossLimit || 3.5;
    const fraction = this.dailyPnL > 0
      ? Math.min(1, this.dailyPnLPercent / limitPct)
      : 0;
    const arc = fraction * c;
    return `${arc} ${Math.max(0, c - arc)}`;
  }
  getWinRingOffset(): number {
    return 0;
  }

  getLossRingDash(): string {
    const c = this.getWinRingCircumference();
    const limitPct = this.mt5AccountInfo?.dailyLossLimit || 3.5;
    const fraction = this.dailyPnL < 0
      ? Math.min(1, Math.abs(this.dailyPnLPercent) / limitPct)
      : 0;
    const arc = fraction * c;
    return `${arc} ${Math.max(0, c - arc)}`;
  }
  getLossRingOffset(): number {
    return 0;
  }

  // Tooltip state for left donut
  donutTooltipVisible: boolean = false;
  donutTooltipX: number = 0;
  donutTooltipY: number = 0;
  donutTooltipLines: string[] = [];
  donutTooltipClass: string = '';
  @ViewChild('dailyLimitChartRef') dailyLimitChartRef?: ElementRef<HTMLDivElement>;

  private showDonutTooltip(evt: MouseEvent, isWin: boolean): void {
    const wins = Math.max(0, this.dailyWinsAmount);
    const losses = Math.abs(Math.min(0, this.dailyLossesAmount));
    const total = wins + losses;
    if (total <= 0) { this.donutTooltipVisible = false; return; }

    const pctSigned = isWin ? this.dailyWinsPercent : this.dailyLossesPercent;
    const percentText = `${pctSigned >= 0 ? '+' : ''}${pctSigned.toFixed(2)}%`;

    const amountUnsigned = isWin ? wins : losses; // positive number
    const amountSigned = isWin ? amountUnsigned : -amountUnsigned;
    const amountText = `${amountSigned >= 0 ? '+' : '-'}$${Math.abs(amountSigned).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

    const container = this.dailyLimitChartRef?.nativeElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      this.donutTooltipX = evt.clientX - rect.left;
      this.donutTooltipY = evt.clientY - rect.top;
    } else {
      this.donutTooltipX = evt.offsetX;
      this.donutTooltipY = evt.offsetY;
    }

    this.donutTooltipLines = [percentText, amountText];
    this.donutTooltipClass = isWin ? 'tooltip-positive' : 'tooltip-danger';
    this.donutTooltipVisible = true;
  }

  onDonutArcEnter(evt: MouseEvent, isWin: boolean): void { this.showDonutTooltip(evt, isWin); }
  onDonutArcMove(evt: MouseEvent, isWin: boolean): void { this.showDonutTooltip(evt, isWin); }
  onDonutArcLeave(): void { this.donutTooltipVisible = false; }

  // Daily Limit ring gauge (left) – map 0–capacity% (e.g., 8%) to full circle
  getDailyLimitRingCircumference(): number { return 2 * Math.PI * 44; }

  private getDailyLimitUsedPct(): number {
    const startBal = this.mt5AccountInfo?.startingBalance || 0;
    const capPct = this.mt5AccountInfo?.dailyLossLimit || 8; // capacity percent (default 8%)
    if (startBal <= 0 || capPct <= 0) return 0;
    const limitAmt = startBal * (capPct / 100);
    const usedAmt = Math.min(limitAmt, Math.max(0, -this.dailyPnL));
    const usedPct = limitAmt > 0 ? (usedAmt / limitAmt) * 100 : 0;
    return Math.max(0, Math.min(100, usedPct));
  }
  getDailyLimitRingDash(): string {
    const c = this.getDailyLimitRingCircumference();
    const fraction = this.getDailyLimitUsedPct() / 100;
    const arc = fraction * c;
    return `${arc} ${Math.max(0, c - arc)}`;
  }
  getDailyLimitRingOffset(): number { return 0; }

  private setupDailyResetTimer(): void {
    // Check every minute for new session boundary and recompute
    setInterval(() => {
      const sessionStart = this.getCurrentSessionStart();
      const key = 'daily_limit_session_start';
      const saved = localStorage.getItem(key);
      const currentKey = sessionStart.toISOString();
      if (saved !== currentKey) {
        localStorage.setItem(key, currentKey);
        this.dailyLimitNotified = false; // reset notification per session
      }
      this.updateDailyLimitMetrics();
    }, 60 * 1000);
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

  // Count-based gauge chart methods for Trade Win %
  getWinGaugeDash(): string {
    const circumference = Math.PI * 60; // Half circle circumference (radius 60)
    const totalTrades = this.getTotalTrades();
    if (totalTrades === 0) return '0 0';

    const winCount = this.getWinCount();
    const winPortion = (winCount / totalTrades) * circumference;
    const gap = circumference - winPortion;
    return `${winPortion} ${gap}`;
  }

  getWinGaugeOffset(): number {
    return 0; // Start from the beginning
  }

  getLossGaugeDash(): string {
    const circumference = Math.PI * 60;
    const totalTrades = this.getTotalTrades();
    if (totalTrades === 0) return '0 0';

    const lossCount = this.getLossCount();
    const lossPortion = (lossCount / totalTrades) * circumference;
    const gap = circumference - lossPortion;
    return `${lossPortion} ${gap}`;
  }

  getLossGaugeOffset(): number {
    const circumference = Math.PI * 60;
    const totalTrades = this.getTotalTrades();
    if (totalTrades === 0) return 0;

    const winCount = this.getWinCount();
    const breakevenCount = this.getBreakevenCount();
    const offsetPortion = (winCount + breakevenCount) / totalTrades;
    return -(circumference * offsetPortion);
  }

  // Legacy methods for compatibility
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

  openRoiEntryModal(): void {
    this.editingRoiTransactionId = null;
    this.roiReceiptFile = null;
    this.roiForm = {
      transaction_type: 'expense',
      transaction_date: new Date().toISOString().slice(0, 10),
      amount: null,
      note: '',
      account_id: '',
      image_url: ''
    };
    this.isRoiEntryModalOpen = true;
  }

  editRoiTransaction(transaction: RoiTransaction): void {
    this.editingRoiTransactionId = transaction.id;
    this.roiReceiptFile = null;
    this.roiForm = {
      transaction_type: transaction.transaction_type,
      transaction_date: transaction.transaction_date,
      amount: Number(transaction.amount),
      note: transaction.note ?? '',
      account_id: transaction.account_id ?? '',
      image_url: transaction.image_url ?? ''
    };
    this.isRoiEntryModalOpen = true;
  }

  closeRoiEntryModal(): void {
    if (!this.isSavingRoi && !this.isDeletingRoi) this.isRoiEntryModalOpen = false;
  }

  get filteredRoiTransactions(): RoiTransaction[] {
    return this.roiFilter === 'all'
      ? this.roiTransactions
      : this.roiTransactions.filter(transaction => transaction.transaction_type === this.roiFilter);
  }

  get pagedRoiTransactions(): RoiTransaction[] {
    const start = (this.roiPage - 1) * this.roiPageSize;
    return this.filteredRoiTransactions.slice(start, start + this.roiPageSize);
  }

  get roiTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRoiTransactions.length / this.roiPageSize));
  }

  get roiPageNumbers(): number[] {
    return Array.from({ length: this.roiTotalPages }, (_, index) => index + 1);
  }

  setRoiFilter(filter: 'all' | 'expense' | 'payout'): void {
    this.roiFilter = filter;
    this.roiPage = 1;
  }

  setRoiPage(page: number): void {
    this.roiPage = Math.min(Math.max(page, 1), this.roiTotalPages);
  }

  onRoiReceiptSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.roiReceiptFile = file?.type.startsWith('image/') ? file : null;
  }

  get roiExpenses(): number {
    return this.roiTransactions
      .filter(transaction => transaction.transaction_type === 'expense')
      .reduce((total, transaction) => total + Number(transaction.amount), 0);
  }

  get roiPayouts(): number {
    return this.roiTransactions
      .filter(transaction => transaction.transaction_type === 'payout')
      .reduce((total, transaction) => total + Number(transaction.amount), 0);
  }

  get roiNetReturn(): number {
    return this.roiPayouts - this.roiExpenses;
  }

  get roiReturnPercentage(): number {
    return this.roiExpenses ? (this.roiNetReturn / this.roiExpenses) * 100 : 0;
  }

  get certificatePayoutTotal(): number {
    return this.certificatePayouts.reduce((total, payout) => total + Number(payout.amount || 0), 0);
  }

  get fundedCertificateCount(): number {
    return this.certificates.filter(certificate => certificate.status === 'funded').length;
  }

  openCertificateCreator(): void {
    this.editingCertificateId = null;
    this.certificateFile = null;
    this.certificateForm = { account_id: this.accounts[0]?.id ?? null, program_name: '', passed_date: new Date().toISOString().slice(0, 10), status: 'passed', notes: '' };
    this.isCertificateModalOpen = true;
  }

  editCertificate(certificate: Certificate): void {
    this.editingCertificateId = certificate.id;
    this.certificateFile = null;
    this.certificateForm = { account_id: certificate.account_id ?? null, program_name: certificate.program_name ?? '', passed_date: certificate.passed_date, status: certificate.status, notes: certificate.notes ?? '' };
    this.isCertificateModalOpen = true;
  }

  closeCertificateModal(): void {
    if (!this.isSavingCertificate) this.isCertificateModalOpen = false;
  }

  cancelCertificateDeletion(): void {
    this.certificateDeleteConfirmationId = null;
    if (this.certificateDeleteConfirmationTimer) window.clearTimeout(this.certificateDeleteConfirmationTimer);
    this.certificateDeleteConfirmationTimer = undefined;
    this.cdr.markForCheck();
  }

  @HostListener('document:keydown.escape')
  cancelCertificateDeletionOnEscape(): void {
    if (this.certificateDeleteConfirmationId) this.cancelCertificateDeletion();
    if (this.certificateImageViewer) this.closeCertificateImageViewer();
  }

  async confirmCertificateDeletion(certificate: Certificate): Promise<void> {
    if (this.isDeletingCertificate) return;
    if (this.certificateDeleteConfirmationId !== certificate.id) {
      this.certificateDeleteConfirmationId = certificate.id;
      this.certificateDeleteConfirmationTimer = window.setTimeout(() => this.cancelCertificateDeletion(), 4000);
      this.cdr.markForCheck();
      return;
    }
    this.isDeletingCertificate = true;
    try {
      await this.supabaseService.deleteCertificate(certificate.id);
      this.certificates = this.certificates.filter(item => item.id !== certificate.id);
      this.cancelCertificateDeletion();
      this.snackBar.open('Certificate deleted.', 'Dismiss', { duration: 3000 });
    } catch (error) {
      console.error('Unable to delete certificate:', error);
      this.snackBar.open(error instanceof Error ? error.message : 'Unable to delete certificate.', 'Dismiss', { duration: 6000 });
    } finally {
      this.isDeletingCertificate = false;
      this.cdr.markForCheck();
    }
  }

  onCertificateFileSelected(event: Event): void {
    this.certificateFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  async saveCertificate(): Promise<void> {
    if (this.isSavingCertificate || !this.certificateForm.account_id || !this.certificateForm.passed_date) return;
    this.isSavingCertificate = true;
    try {
      const updates = { ...this.certificateForm, program_name: this.certificateForm.program_name.trim() || null, notes: this.certificateForm.notes.trim() || null };
      const saved = this.editingCertificateId
        ? await this.supabaseService.updateCertificate(this.editingCertificateId, updates)
        : await this.supabaseService.createCertificate(updates);
      const uploadedFilePath = this.certificateFile ? await this.supabaseService.uploadCertificateFile(this.certificateFile, saved.id, this.getCertificateFirmName(saved)) : saved.file_path;
      const savedCertificate = { ...saved, file_path: uploadedFilePath };
      this.certificates = this.editingCertificateId ? this.certificates.map(item => item.id === saved.id ? { ...item, ...savedCertificate } : item) : [savedCertificate, ...this.certificates];
      await Promise.all([
        this.loadCertificatePreviewUrls(this.certificates),
        this.loadPayoutProofUrls(this.certificatePayouts)
      ]);
      this.isCertificateModalOpen = false;
      this.snackBar.open(this.editingCertificateId ? 'Certificate updated.' : 'Certificate added.', 'Dismiss', { duration: 3000 });
    } catch (error) {
      console.error('Unable to save certificate:', error);
      this.snackBar.open(error instanceof Error ? error.message : 'Unable to save certificate.', 'Dismiss', { duration: 6000 });
    } finally {
      this.isSavingCertificate = false;
      this.cdr.markForCheck();
    }
  }

  openPayoutCreator(): void {
    this.payoutForm = { certificate_id: this.certificates[0]?.id ?? '', amount: null, payout_date: new Date().toISOString().slice(0, 10), notes: '', proof_url: '' };
    this.isPayoutModalOpen = true;
  }

  closePayoutModal(): void {
    if (!this.isSavingPayout) this.isPayoutModalOpen = false;
  }

  async savePayout(): Promise<void> {
    const certificate = this.certificates.find(item => item.id === this.payoutForm.certificate_id);
    if (this.isSavingPayout || !certificate || !this.payoutForm.amount) return;
    this.isSavingPayout = true;
    try {
      const payout = await this.supabaseService.createPayout({ certificate_id: certificate.id, firm_name: this.getCertificateFirmName(certificate), amount: this.payoutForm.amount, payout_date: this.payoutForm.payout_date, notes: this.payoutForm.notes.trim() || null, proof_url: this.payoutForm.proof_url.trim() || null });
      this.certificatePayouts = [payout, ...this.certificatePayouts];
      await this.loadPayoutProofUrls(this.certificatePayouts);
      this.isPayoutModalOpen = false;
      this.snackBar.open('Payout recorded.', 'Dismiss', { duration: 3000 });
    } catch (error) {
      console.error('Unable to save payout:', error);
      this.snackBar.open(error instanceof Error ? error.message : 'Unable to save payout.', 'Dismiss', { duration: 6000 });
    } finally {
      this.isSavingPayout = false;
      this.cdr.markForCheck();
    }
  }

  getCertificateAccount(certificate: Certificate): Account | null {
    return this.accounts.find(account => account.id === certificate.account_id) ?? null;
  }

  getAccountById(accountId: string | null): Account | null {
    return accountId ? this.accounts.find(account => account.id === accountId) ?? null : null;
  }

  getFirmNameForAccount(account: Account): string {
    return this.propFirms.find(firm => firm.id === account.prop_firm_id)?.name || 'Independent firm';
  }

  getCertificateFirmName(certificate: Certificate): string {
    const account = this.getCertificateAccount(certificate);
    return account ? this.getFirmNameForAccount(account) : 'Independent certificate';
  }

  getPayoutFirmName(payout: Payout): string {
    const certificate = this.certificates.find(item => item.id === payout.certificate_id);
    if (certificate?.account_id) return this.getCertificateFirmName(certificate);
    return payout.firm_name?.trim() || 'Independent firm';
  }

  getPayoutAccountName(payout: Payout): string | null {
    const accountId = payout.account_id ?? this.certificates.find(item => item.id === payout.certificate_id)?.account_id;
    return accountId ? this.getAccountById(accountId)?.name ?? null : null;
  }

  getPayoutAccountPhase(payout: Payout): string {
    const certificate = this.certificates.find(item => item.id === payout.certificate_id);
    if (certificate?.account_id) return this.getCertificateAccountPhase(certificate);
    const account = this.getAccountById(payout.account_id ?? null);
    const phase = account?.phase;
    return phase === 'phase2' ? 'Phase 2' : phase === 'funded' ? 'Funded' : phase === 'phase1' ? 'Phase 1' : '—';
  }

  getCertificateAccountSize(certificate: Certificate): number | null {
    return this.getCertificateAccount(certificate)?.initial_balance ?? null;
  }

  getCertificateAccountPhase(certificate: Certificate): string {
    const phase = this.getCertificateAccount(certificate)?.phase;
    return phase === 'phase2' ? 'Phase 2' : phase === 'funded' ? 'Funded' : phase === 'phase1' ? 'Phase 1' : '—';
  }

  getCertificatePreviewUrl(certificate: Certificate): string | null {
    return certificate.file_path && !certificate.file_path.startsWith('http') ? this.certificatePreviewUrls[certificate.id] ?? null : null;
  }

  openCertificateImageViewer(certificate: Certificate): void {
    const url = this.getCertificatePreviewUrl(certificate);
    if (!url) return;
    this.certificateImageViewer = { url, alt: `${this.getCertificateFirmName(certificate)} certificate` };
  }

  closeCertificateImageViewer(): void {
    this.certificateImageViewer = null;
  }

  private async loadCertificatePreviewUrls(certificates: Certificate[]): Promise<void> {
    const previewUrls: Record<string, string> = {};
    for (const certificate of certificates) {
      if (!certificate.file_path || certificate.file_path.startsWith('http')) continue;
      const signedUrl = await this.supabaseService.getCertificateFileUrl(certificate.file_path);
      if (signedUrl) previewUrls[certificate.id] = signedUrl;
    }
    this.certificatePreviewUrls = previewUrls;
  }

  getPayoutProofUrl(payout: Payout): string | null {
    if (!payout.proof_url) return null;
    return payout.proof_url.startsWith('http') ? payout.proof_url : this.payoutProofUrls[payout.id] ?? null;
  }

  private async loadPayoutProofUrls(payouts: Payout[]): Promise<void> {
    const proofUrls: Record<string, string> = {};
    for (const payout of payouts) {
      if (!payout.proof_url || payout.proof_url.startsWith('http')) continue;
      const signedUrl = await this.supabaseService.getCertificateFileUrl(payout.proof_url);
      if (signedUrl) proofUrls[payout.id] = signedUrl;
    }
    this.payoutProofUrls = proofUrls;
  }

  private async loadCertificates(): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) return;
    this.isLoadingCertificates = true;
    try {
      this.propFirms = await this.supabaseService.getPropFirms();
    } catch (error) {
      console.warn('Prop firm directory unavailable for certificates.', error);
    }
    const suppliedCertificates: Omit<Certificate, 'id' | 'user_id' | 'created_at' | 'payouts'>[] = [
      {

        account_id: this.accounts[0]?.id,
        program_name: 'High Stakes, 5K',
        passed_date: '2025-12-05',
        status: 'funded',

      },
      {

        account_id: this.accounts[0]?.id,
        program_name: 'Officially Funded Trader',
        passed_date: '2026-08-05',
        status: 'funded',

      },
      {

        account_id: this.accounts[0]?.id,
        program_name: 'High Stakes, 2.5K',
        passed_date: '2026-07-10',
        status: 'funded',

      }
    ];

    try {
      let roiTransactions: RoiTransaction[] = [];
      [this.certificates, this.certificatePayouts, roiTransactions] = await Promise.all([
        this.supabaseService.getCertificates(userId),
        this.supabaseService.getPayouts(userId),
        this.supabaseService.getRoiTransactions(userId)
      ]);
      this.certificatePayouts = this.certificatePayouts.map(payout => ({
        ...payout,
        firm_name: this.getPayoutFirmName(payout)
      }));
      const roiPayouts: Payout[] = roiTransactions
        .filter(transaction => transaction.transaction_type === 'payout')
        .map(transaction => {
          const account = this.getAccountById(transaction.account_id ?? null);
          return {
            id: `roi-payout-${transaction.id}`,
            certificate_id: null,
            account_id: transaction.account_id ?? null,
            user_id: userId,
            firm_name: account ? this.getFirmNameForAccount(account) : transaction.accounts?.name || 'Independent firm',
            amount: Number(transaction.amount),
            payout_date: transaction.transaction_date,
            notes: transaction.note,
            proof_url: transaction.image_url,
            source: 'roi' as const,
            created_at: transaction.created_at
          };
        });
      this.certificatePayouts = [...this.certificatePayouts, ...roiPayouts]
        .sort((left, right) => right.payout_date.localeCompare(left.payout_date));
      if (!this.certificates.length) {
        for (const certificate of suppliedCertificates) {
          await this.supabaseService.createCertificate(certificate);
        }
        this.certificates = await this.supabaseService.getCertificates(userId);
      }
      await Promise.all([
        this.loadCertificatePreviewUrls(this.certificates),
        this.loadPayoutProofUrls(this.certificatePayouts)
      ]);
    } catch (error) {
      console.error('Unable to load certificates:', error);
      this.certificates = suppliedCertificates.map((certificate, index) => ({ ...certificate, id: `supplied-certificate-${index}` }));
      this.certificatePreviewUrls = {};
      this.payoutProofUrls = {};
      this.certificatePayouts = [];
      this.snackBar.open('Showing your certificates locally. Create the Supabase tables to save them permanently.', 'Dismiss', { duration: 7000 });
    } finally {
      this.isLoadingCertificates = false;
      this.cdr.markForCheck();
    }
  }

  private async loadRoiTransactions(): Promise<void> {
    this.isLoadingRoi = true;
    try {
      const userId = this.auth.user()?.id;
      this.roiTransactions = userId ? await this.supabaseService.getRoiTransactions(userId) : [];
    } catch (error) {
      console.error('Unable to load ROI transactions:', error);
      this.snackBar.open('Unable to load ROI transactions from Supabase.', 'Dismiss', { duration: 6000 });
    } finally {
      this.isLoadingRoi = false;
      this.cdr.markForCheck();
    }
  }

  async saveRoiTransaction(): Promise<void> {
    if (!this.roiForm.amount || this.roiForm.amount <= 0) return;
    this.isSavingRoi = true;
    try {
      const userId = this.auth.user()?.id;
      if (!userId) throw new Error('You must be signed in to save an ROI transaction.');
      let imageUrl = this.roiForm.image_url.trim() || null;
      if (this.roiReceiptFile) {
        const payoutAccount = this.getAccountById(this.roiForm.account_id);
        const payoutFirmName = payoutAccount ? this.getFirmNameForAccount(payoutAccount) : 'Independent firm';
        imageUrl = await this.supabaseService.uploadRoiPayoutFile(this.roiReceiptFile, payoutFirmName);
      }
      const transactionData = {
        transaction_type: this.roiForm.transaction_type,
        transaction_date: this.roiForm.transaction_date,
        amount: this.roiForm.amount,
        note: this.roiForm.note.trim() || null,
        image_url: imageUrl,
        account_id: this.roiForm.account_id || null
      };
      const editingId = this.editingRoiTransactionId;
      const savedTransaction = editingId
        ? await this.supabaseService.updateRoiTransaction(editingId, transactionData)
        : await this.supabaseService.createRoiTransaction(transactionData, userId);
      this.roiTransactions = editingId
        ? this.roiTransactions.map(transaction => transaction.id === savedTransaction.id ? savedTransaction : transaction)
        : [savedTransaction, ...this.roiTransactions];
      this.roiPage = editingId ? Math.min(this.roiPage, this.roiTotalPages) : 1;
      this.editingRoiTransactionId = null;
      this.roiReceiptFile = null;
      this.isRoiEntryModalOpen = false;
      this.snackBar.open(editingId ? 'ROI transaction updated.' : 'ROI transaction saved.', 'Dismiss', { duration: 3000 });
    } catch (error) {
      console.error('Unable to save ROI transaction:', error);
      this.snackBar.open(error instanceof Error ? error.message : 'Unable to save ROI transaction.', 'Dismiss', { duration: 6000 });
    } finally {
      this.isSavingRoi = false;
      this.cdr.markForCheck();
    }
  }

  async deleteRoiTransaction(transaction: RoiTransaction): Promise<void> {
    if (this.isDeletingRoi || !window.confirm('Delete this ROI transaction?')) return;
    this.isDeletingRoi = true;
    try {
      await this.supabaseService.deleteRoiTransaction(transaction.id);
      this.roiTransactions = this.roiTransactions.filter(item => item.id !== transaction.id);
      this.roiPage = Math.min(this.roiPage, this.roiTotalPages);
      this.snackBar.open('ROI transaction deleted.', 'Dismiss', { duration: 3000 });
    } catch (error) {
      console.error('Unable to delete ROI transaction:', error);
      this.snackBar.open(error instanceof Error ? error.message : 'Unable to delete ROI transaction.', 'Dismiss', { duration: 6000 });
    } finally {
      this.isDeletingRoi = false;
      this.cdr.markForCheck();
    }
  }

  formatRoiDate(date: string): string {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00`));
  }

  private async loadAccounts(): Promise<void> {
    this.isLoadingAccounts = true;
    try {
      this.accounts = await this.supabaseService.getAccounts();
      try {
        this.propFirms = await this.supabaseService.getPropFirms();
      } catch (error) {
        console.warn('Prop firm directory unavailable; using account firm names.', error);
        this.propFirms = [
          { id: 'the5ers', name: 'The5ers' },
          { id: 'ftmo', name: 'FTMO' },
          { id: 'funding-pips', name: 'Funding Pips' },
          { id: 'funded-next', name: 'FundedNext' }
        ];
      }
      const user = this.auth.user();
      const userId = user?.id;
      const [savedSettings, profile] = userId
        ? await Promise.all([this.supabaseService.getUserSettings(userId), this.supabaseService.getProfile(userId)])
        : [null, null];
      this.profileDisplayName = profile?.display_name?.trim() || user?.user_metadata?.['display_name'] || user?.email?.split('@')[0] || 'Trader';
      this.profileAvatarUrl = profile?.avatar_url?.trim() || user?.user_metadata?.['avatar_url'] || '';
      const savedAccountId = localStorage.getItem(this.selectedAccountStorageKey) || savedSettings?.default_account_id;
      this.selectedAccount = this.accounts.find(account => account.id === savedAccountId) ?? this.accounts[0] ?? null;
      if (savedSettings) this.applyPersistedUserSettings(savedSettings);
      if (this.selectedAccount) {
        localStorage.setItem(this.selectedAccountStorageKey, this.selectedAccount.id);
      } else {
        localStorage.removeItem(this.selectedAccountStorageKey);
      }
      this.mt5SyncAccountId = this.selectedAccount?.id ?? '';
      this.selectedFirm = this.selectedAccount ? this.getFirmName(this.selectedAccount) : null;
      this.applySelectedAccountSettings();
    } catch (error) {
      console.error('Unable to load Supabase accounts:', error);
      this.snackBar.open('Unable to load accounts from Supabase.', 'Dismiss', { duration: 6000 });
    } finally {
      this.isLoadingAccounts = false;
      this.cdr.markForCheck();
    }
  }

  private loadLiveTradeDisplayPreferences(): Partial<LiveTradeDisplayPreferences> {
    try {
      const saved = this.document.defaultView?.localStorage.getItem(this.liveTradeDisplayPreferencesStorageKey);
      return saved ? JSON.parse(saved) as Partial<LiveTradeDisplayPreferences> : {};
    } catch {
      return {};
    }
  }

  private inferAccountSize(account: Account | null): number {
    const sizeMatch = account?.name.match(/(\d+(?:\.\d+)?)\s*k\b/i);
    return sizeMatch ? Number(sizeMatch[1]) * 1000 : 0;
  }

  private applyPersistedUserSettings(settings: UserSettings): void {
    this.isDailyChart = settings.default_chart_mode === 'daily';
    const savedDisplayPreferences = this.loadLiveTradeDisplayPreferences();
    const alertThreshold = Number.isFinite(Number(savedDisplayPreferences.soundThreshold))
      ? Number(savedDisplayPreferences.soundThreshold)
      : settings.sound_notifications_threshold;
    const savedHighAlertThreshold = Number(savedDisplayPreferences.highPrioritySoundThreshold);
    const highAlertThreshold = Number.isFinite(savedHighAlertThreshold)
      && savedHighAlertThreshold > alertThreshold
      ? savedHighAlertThreshold
      : Math.max(alertThreshold, alertThreshold + 0.6);
    this.liveTradeSoundSettings = {
      enabled: typeof savedDisplayPreferences.soundEnabled === 'boolean'
        ? savedDisplayPreferences.soundEnabled
        : settings.notifications_enabled && settings.goal_notification_sound,
      alertThreshold,
      highAlertThreshold,
      volume: settings.notification_volume
    };
    this.auraEnergy.updateConfig({
      enabled: settings.aura_enabled,
      travelDurationMs: settings.aura_travel_duration_ms,
      minDelayMs: settings.aura_min_delay_ms,
      maxDelayMs: settings.aura_max_delay_ms,
      trailLengthPercent: settings.aura_trail_length_percent,
      strokeWidth: settings.aura_stroke_width,
      headRadius: settings.aura_head_radius,
      bloomIntensity: settings.aura_bloom_intensity,
      fadeDurationMs: settings.aura_fade_duration_ms,
      colorStart: settings.aura_color_start,
      colorMid: settings.aura_color_mid,
      colorPeak: settings.aura_color_peak,
      colorHead: settings.aura_color_head,
      minTargets: settings.aura_min_targets,
      maxTargets: settings.aura_max_targets
    });
  }

  private applySelectedAccountSettings(): void {
    const account = this.selectedAccount;
    this.mt5AccountInfo = {
      ...this.mt5AccountInfo,
      startingBalance: account?.initial_balance ?? this.inferAccountSize(account),
      profitTarget: account?.profit_target_percent ?? 0,
      maxTotalDrawdown: account?.max_total_drawdown_percent ?? 0,
      dailyLossLimit: account?.daily_loss_limit_percent ?? 0
    };
    this.dropdownSelectedSize = this.mt5AccountInfo.startingBalance;
  }

  async selectAccount(account: Account): Promise<void> {
    if (this.selectedAccount?.id === account.id) {
      this.navigateToWorkspace('dashboard');
      return;
    }

    this.selectedAccount = account;
    localStorage.setItem(this.selectedAccountStorageKey, account.id);
    this.mt5LiveTrades = [];
    this.recentlyAddedTrades = [];
    this.mt5OpenPositionIds = new Set();
    this.updateTableData();
    this.applySelectedAccountSettings();
    this.currentPage = 1;
    this.cdr.markForCheck();
    await this.loadMT5Data();
    this.generateTradingChartData();
    this.cdr.markForCheck();
    this.navigateToWorkspace('dashboard');
    this.snackBar.open(`Showing ${account.name}.`, 'Dismiss', { duration: 3000 });
  }

	async ngOnInit() {
    // Set up click outside listener for dropdown
    this.setupClickOutsideListener();
    await this.loadAccounts();
    if (this.currentWorkspace === 'roi') await this.loadRoiTransactions();
    if (this.currentWorkspace === 'certificates') await this.loadCertificates();

    // Load MT5 data immediately
    try {
      await this.loadMT5Data();
    } catch (error) {
      console.error('❌ ngOnInit: Error loading MT5 data:', error);
    }

    const socket = io(`${this.BACKEND_URL_MT5}/`,{
      transports: ['websocket'], // ��� Force WebSocket to avoid polling
      upgrade: false,              // Optional, disables fallback to long-polling
    });

    socket.on("connect", async () => {
      console.warn("✅ Connected to WebSocket server");
      // Reload MT5 data for live updates
      await this.loadMT5Data();
    });

    socket.on("account_info", (data) => {
      this.mt5AccountLogin = this.normalizeAccountNumber(data?.login);
      const balance = Number(data?.balance ?? data?.account_balance ?? data?.equity);
      if (Number.isFinite(balance) && balance > 0) {
        this.mt5AccountInfo.balance = balance;
        this.generateTradingChartData();
      }
      if (!this.isActiveMt5Account()) {
        this.mt5LiveTrades = [];
        this.recentlyAddedTrades = [];
        this.mt5OpenPositionIds = new Set();
        this.updateTableData();
      } else {
        void this.loadMT5Data();
      }
      this.cdr.markForCheck();
      console.warn("Account Info Received:", data);
    });

    socket.on("connect_error", (err: any) => {
      console.warn("❌ Socket connection error:", err);
      // Data already loaded at startup
    });

    socket.on("trade_opened", (data: any) => {
      if (!this.isActiveMt5Account()) return;
      console.warn("New trade opened:", data);
      this.addMT5LiveTrade(data);
    });

    socket.on("trade_closed", (data: any) => {
      console.warn("Trade closed:", data);
      this.closeMT5Trade(data);
    });

    socket.on('price_update', (data: any) => {
      if (!this.isActiveMt5Account()) return;
      // Update the price for existing trade (includes live_rr)
      this.updateMT5TradePrice(data);

      // Trigger change detection to display live trading session
      this.cdr.markForCheck();

    });

    // Start daily limit tracking
    this.setupDailyResetTimer();
    this.updateResetCountdown();
    setInterval(() => this.updateResetCountdown(), 1000);

    try {
      const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const news: any = await firstValueFrom(
        this.http.get(`${environment.backendUrlNotion}/api/news?timezone=${encodeURIComponent(browserTimeZone)}`)
      );
      this.newsData = Array.isArray(news) ? news : [];

      // Ensure in-app UI reminders (sound + modal) are active regardless of FCM
      this.newsReminder.setUiReminderCallback((events: any[], minutesBefore: number) => {
        this.handleNewsUiReminder(events, minutesBefore);
      });

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
      this.cdr.markForCheck();
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
      order: [[1, 'asc']], // Sort by date ascending by default
      columnDefs: [
        { targets: [2, 3, 5, 6, 7, 8, 9, 10], className: 'text-center' }, // Center align numeric columns
        { targets: [2, 5, 6, 7, 8, 9, 10], type: 'num' } // Specify numeric sorting
      ]
    };

    // await this.loadTrades(); // Load trades from Firestore
    // await this.loadMT5Data(); // Load MT5 trades
    // this.addTradesToCalendar(); // Add trades to calendar events

 

    // Simple table - no DataTables initialization needed!

    // Generate initial chart data
    this.generateTradingChartData();
    this.updateDailyLimitMetrics();

    // Set loading to false after a short delay to show metrics even without data
    // This is a fallback in case socket connection fails
    setTimeout(() => {
      if (this.isLoadingMetrics) {
        console.warn('⚠️ Metrics still loading after 1.5s, forcing completion');
        this.isLoadingMetrics = false;
        this.isLoadingMT5Data = false;
        this.cdr.markForCheck();
        this.cdr.detectChanges();
      }
    }, 1500);

    // Removed complex dummy data as requested by user
  }

  async ngAfterViewInit(): Promise<void> {
    setTimeout(() => {
      this.generateTradingChartData();
    }, 1000);

    this.auraConfig = this.auraEnergy.getConfig();
    this.auraEnergy.start();
    this.cdr.markForCheck();
  }

  initializeDataTable(): void {
    try {
      // Use Angular DataTables trigger for complex column support
      this.dtTrigger.next(null);

    } catch (error) {
      console.error('❌ Error initializing DataTable:', error);
    }
  }

  refreshDataTableWithAngularBinding(): void {
    try {
      // Force Angular change detection first
      this.cdr.detectChanges();

      // For Angular DataTables, we need to destroy and recreate to pick up new data
      setTimeout(() => {
        if ($.fn.dataTable.isDataTable('#myTable')) {
          $('#myTable').DataTable().destroy();
        }

        // Trigger recreation with new data
        setTimeout(() => {
          this.dtTrigger.next(null);
        }, 100);
      }, 50);

    } catch (error) {
      console.error('❌ Error refreshing DataTable with Angular binding:', error);
    }
  }

  ngOnDestroy(): void {
    if (this.liveExtremesCacheTimer) {
      window.clearTimeout(this.liveExtremesCacheTimer);
    }
    this.dismissNewsReminder();
    this.newsReminder.clearAllReminders();
    this.auraEnergy.destroy();
    // Clean up click outside listener
    this.removeClickOutsideListener();

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
  this.events = [];
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
    const sum = events
      .filter(event => event.meta?.profit > 0)
      .reduce((acc: number, event: any) => acc + (event.meta?.profit || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  totalLoss(events: any[]): number {
    const sum = events
      .filter(event => event.meta?.profit < 0)
      .reduce((acc: number, event: any) => acc + (event.meta?.profit || 0), 0);
    return Math.round(sum * 100) / 100;
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

  onMt5ReportSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.mt5ImportMessage = '';
    this.mt5ImportError = '';
    const reader = new FileReader();
    reader.onload = (loadEvent: ProgressEvent<FileReader>) => {
      try {
        const data = new Uint8Array(loadEvent.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });
        const headerIndex = rows.findIndex(row => this.isMt5PositionsHeader(row));

        if (headerIndex < 0) {
          this.mt5ImportError = 'No MT5 Positions table was found in this workbook.';
          this.cdr.markForCheck();
          return;
        }

        const headers = rows[headerIndex].map((value: unknown) => this.normalizeMt5Header(value));
        const timeColumns = this.findMt5ColumnIndexes(headers, 'time');
        const priceColumns = this.findMt5ColumnIndexes(headers, 'price');
        const positionIndex = this.findMt5ColumnIndex(headers, 'position');
        const symbolIndex = this.findMt5ColumnIndex(headers, 'symbol');
        const typeIndex = this.findMt5ColumnIndex(headers, 'type');
        const volumeIndex = this.findMt5ColumnIndex(headers, 'volume');
        const stopLossIndex = this.findMt5ColumnIndex(headers, 's/l');
        const takeProfitIndex = this.findMt5ColumnIndex(headers, 't/p');
        const commissionIndex = this.findMt5ColumnIndex(headers, 'commission');
        const swapIndex = this.findMt5ColumnIndex(headers, 'swap');
        const profitIndex = this.findMt5ColumnIndex(headers, 'profit');

        const positionRows = rows.slice(headerIndex + 1);
        const ordersIndex = positionRows.findIndex(row => String(row[0] ?? '').trim().toLowerCase() === 'orders');
        const importedTrades = (ordersIndex >= 0 ? positionRows.slice(0, ordersIndex) : positionRows)
          .filter(row => row[symbolIndex] && row[positionIndex])
          .map(row => {
            const commission = this.toMt5Number(row[commissionIndex]);
            const swap = this.toMt5Number(row[swapIndex]);
            const profit = this.toMt5Number(row[profitIndex]);
            return {
              openDate: this.formatMt5Value(row[timeColumns[0]]),
              tradeNotion: [],
              status: 'Imported',
              position: this.formatMt5Value(row[positionIndex]),
              symbol: this.formatMt5Value(row[symbolIndex]),
              type: this.formatMt5Value(row[typeIndex]),
              volume: this.formatMt5Value(row[volumeIndex]),
              entry: this.formatMt5Value(row[priceColumns[0]]),
              sL: this.formatMt5Value(row[stopLossIndex]),
              tP: this.formatMt5Value(row[takeProfitIndex]),
              closeDate: this.formatMt5Value(row[timeColumns[1]]),
              exit: this.formatMt5Value(row[priceColumns[1]]),
              commission: commission.toFixed(2),
              swap: swap.toFixed(2),
              profit: profit.toFixed(2),
              netProfit: (profit + commission + swap).toFixed(2),
              riskPerTrade: '0',
              rrr: '0',
              mt5status: 'closed',
              mfe: '0'
            } as Table;
          });

        if (!importedTrades.length) {
          this.mt5ImportError = 'The MT5 Positions table did not contain any trades.';
          this.cdr.markForCheck();
          return;
        }

        this.mt5ImportedTrades = importedTrades;
        this.mt5ImportMessage = `${importedTrades.length} MT5 trade${importedTrades.length === 1 ? '' : 's'} imported.`;
        this.cdr.markForCheck();
      } catch (error) {
        console.error('Unable to import MT5 report:', error);
        this.mt5ImportError = 'The MT5 report could not be read. Please choose an Excel workbook.';
        this.cdr.markForCheck();
      }
    };
    reader.onerror = () => {
      this.mt5ImportError = 'The MT5 report could not be read.';
      this.cdr.markForCheck();
    };
    reader.readAsArrayBuffer(file);
  }

  onFixTicketFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.fixTicketRows = [];
    this.fixTicketDbRows = [];
    this.fixTicketManualTickets = {};
    this.fixTicketComparisonVisible = false;
    this.fixTicketFileName = file?.name || '';
    this.fixTicketStatus = 'idle';
    this.fixTicketStatusMessage = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = loadEvent => {
      try {
        const data = new Uint8Array(loadEvent.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' });
        const headerIndex = rows.findIndex(row => this.isMt5PositionsHeader(row));
        if (headerIndex < 0) throw new Error('No MT5 Positions table was found in this workbook.');

        const headers = rows[headerIndex].map(value => this.normalizeMt5Header(value));
        const timeIndex = this.findMt5ColumnIndex(headers, 'time');
        const positionIndex = this.findMt5ColumnIndex(headers, 'position');
        if (timeIndex < 0 || positionIndex < 0) throw new Error('The report is missing the Time or Position column.');

        const positionRows = rows.slice(headerIndex + 1);
        const ordersIndex = positionRows.findIndex(row => String(row[0] ?? '').trim().toLowerCase() === 'orders');
        const importedRows = (ordersIndex >= 0 ? positionRows.slice(0, ordersIndex) : positionRows)
          .filter(row => row[positionIndex] !== '' && row[positionIndex] !== null && row[timeIndex] !== '' && row[timeIndex] !== null)
          .map(row => {
            const openTime = this.formatMt5Value(row[timeIndex]);
            return {
              openTime,
              adjustedOpenTime: this.formatMt5AdjustedMinute(row[timeIndex]),
              ticket: this.formatMt5Ticket(row[positionIndex]),
              matched: false
            };
          })
          .filter(row => row.ticket && row.openTime);

        if (!importedRows.length) throw new Error('No ticket and open-time pairs were found in the workbook.');
        this.fixTicketRows = importedRows;
        this.fixTicketStatus = 'ready';
        this.fixTicketStatusMessage = `${importedRows.length} ticket${importedRows.length === 1 ? '' : 's'} ready to match.`;
      } catch (error) {
        this.fixTicketStatus = 'error';
        this.fixTicketStatusMessage = error instanceof Error ? error.message : 'The MT5 report could not be read.';
      }
      this.cdr.markForCheck();
    };
    reader.onerror = () => {
      this.fixTicketStatus = 'error';
      this.fixTicketStatusMessage = 'The MT5 report could not be read.';
      this.cdr.markForCheck();
    };
    reader.readAsArrayBuffer(file);
  }

  async compareNullTradeTickets(): Promise<void> {
    if (this.isFixingTradeTickets || !this.fixTicketRows.length || !this.fixTicketAccountId) return;

    this.isFixingTradeTickets = true;
    this.fixTicketStatus = 'fixing';
    this.fixTicketProgress = 5;
    this.fixTicketStatusMessage = 'Loading trades with null tickets...';
    this.cdr.markForCheck();

    try {
      const nullTicketTrades = await this.supabaseService.getTradesWithNullTickets(this.fixTicketAccountId);
      this.fixTicketDbRows = nullTicketTrades;
      this.fixTicketComparisonVisible = true;
      const dbTradesByMinute = new Map<string, Trade[]>();
      for (const trade of nullTicketTrades) {
        const key = this.getMt5MinuteKey(trade.time_open);
        if (!key) continue;
        const tradesForMinute = dbTradesByMinute.get(key) || [];
        tradesForMinute.push(trade);
        dbTradesByMinute.set(key, tradesForMinute);
      }

      let matched = 0;
      this.fixTicketRows = this.fixTicketRows.map(row => {
        const key = this.getMt5MinuteKey(row.openTime, 5);
        const tradesForMinute = key ? dbTradesByMinute.get(key) : undefined;
        const matchingTrade = tradesForMinute?.shift();
        if (matchingTrade?.id) matched++;
        return { ...row, matched: Boolean(matchingTrade?.id), matchedTradeId: matchingTrade?.id };
      });

      this.fixTicketProgress = 100;
      this.fixTicketStatus = 'success';
      this.fixTicketStatusMessage = `Comparison complete: ${matched} of ${this.fixTicketRows.length} Excel positions matched. Review the tables, then patch matched tickets.`;
    } catch (error) {
      this.fixTicketStatus = 'error';
      this.fixTicketStatusMessage = error instanceof Error ? error.message : 'Ticket comparison failed.';
    } finally {
      this.isFixingTradeTickets = false;
      this.cdr.markForCheck();
    }
  }

  isFixTicketTradeMatched(tradeId?: string): boolean {
    return Boolean(tradeId && this.fixTicketRows.some(row => row.matchedTradeId === tradeId && row.matched));
  }

  getFixTicketInputValue(trade: Trade): string {
    const matchedRow = this.fixTicketRows.find(row => row.matchedTradeId === trade.id && row.matched);
    return matchedRow?.ticket || (trade.id ? this.fixTicketManualTickets[trade.id] || '' : '');
  }

  setFixTicketInputValue(trade: Trade, value: string): void {
    if (!trade.id || this.isFixTicketTradeMatched(trade.id)) return;
    this.fixTicketManualTickets[trade.id] = value;
  }

  async patchMatchedTradeTickets(): Promise<void> {
    const patchRows = this.fixTicketDbRows
      .map(trade => {
        const matchedRow = this.fixTicketRows.find(row => row.matchedTradeId === trade.id && row.matched);
        const ticket = matchedRow?.ticket || (trade.id ? this.fixTicketManualTickets[trade.id]?.trim() : '');
        return trade.id && ticket ? { tradeId: trade.id, ticket } : null;
      })
      .filter((row): row is { tradeId: string; ticket: string } => row !== null);
    if (this.isFixingTradeTickets || !patchRows.length) return;

    this.isFixingTradeTickets = true;
    this.fixTicketStatus = 'fixing';
    this.fixTicketProgress = 0;
    this.fixTicketStatusMessage = `Patching 0 of ${patchRows.length} tickets...`;
    this.cdr.markForCheck();

    try {
      for (const [index, row] of patchRows.entries()) {
        await this.supabaseService.updateTradeTicket(row.tradeId, row.ticket);
        const dbTrade = this.fixTicketDbRows.find(trade => trade.id === row.tradeId);
        if (dbTrade) dbTrade.ticket = row.ticket;
        this.fixTicketProgress = Math.round(((index + 1) / patchRows.length) * 100);
        this.fixTicketStatusMessage = `Patched ${index + 1} of ${patchRows.length} tickets.`;
        this.cdr.markForCheck();
      }
      this.fixTicketStatus = 'success';
      this.fixTicketStatusMessage = `${patchRows.length} ticket${patchRows.length === 1 ? '' : 's'} patched to Supabase.`;
    } catch (error) {
      this.fixTicketStatus = 'error';
      this.fixTicketStatusMessage = error instanceof Error ? error.message : 'Ticket patching failed.';
    } finally {
      this.isFixingTradeTickets = false;
      this.cdr.markForCheck();
    }
  }

  dismissFixTicketStatus(): void {
    if (this.isFixingTradeTickets) return;
    this.fixTicketStatus = this.fixTicketRows.length ? 'ready' : 'idle';
    this.fixTicketStatusMessage = this.fixTicketRows.length ? `${this.fixTicketRows.length} ticket${this.fixTicketRows.length === 1 ? '' : 's'} ready to match.` : '';
    this.cdr.markForCheck();
  }

  private formatMt5AdjustedMinute(value: unknown): string {
    const key = this.getMt5MinuteKey(this.formatMt5Value(value), 5);
    return key ? `${key.replace('T', ' ')}:00` : this.formatMt5Value(value);
  }

  formatMt5ComparisonTime(value?: string): string {
    const key = this.getMt5MinuteKey(value);
    return key ? `${key.replace('T', ' ')}:00` : value || '-';
  }

  private formatMt5Ticket(value: unknown): string {
    const formatted = this.formatMt5Value(value);
    const numeric = Number(formatted);
    return Number.isFinite(numeric) ? String(Math.trunc(numeric)) : formatted;
  }

  private getMt5MinuteKey(value?: string, addHours = 0): string | undefined {
    if (!value) return undefined;
    const match = value.match(/^(\d{4})[.-](\d{2})[.-](\d{2})[\sT]+(\d{2}):(\d{2})/);
    if (!match) return undefined;
    const [, year, month, day, hour, minute] = match.map(Number);
    const timestamp = Date.UTC(year, month - 1, day, hour, minute) + addHours * 60 * 60 * 1000;
    return new Date(timestamp).toISOString().slice(0, 16);
  }

  private normalizeMt5Header(value: unknown): string {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  }

  private isMt5PositionsHeader(row: unknown[]): boolean {
    const headers = row.map(value => this.normalizeMt5Header(value));
    return headers.includes('position') && headers.includes('symbol') && headers.includes('profit');
  }

  private findMt5ColumnIndexes(headers: string[], name: string): number[] {
    return headers.reduce((indexes: number[], header, index) => {
      if (header === name) indexes.push(index);
      return indexes;
    }, []);
  }

  private findMt5ColumnIndex(headers: string[], name: string): number {
    return headers.indexOf(name);
  }

  private formatMt5Value(value: unknown): string {
    if (value instanceof Date) {
      return `${String(value.getFullYear()).padStart(4, '0')}.${String(value.getMonth() + 1).padStart(2, '0')}.${String(value.getDate()).padStart(2, '0')} ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
    }
    return String(value ?? '').trim();
  }

  private toMt5Number(value: unknown): number {
    const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
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
  
  // (removed unused real-time trades listener)
  
  loadTrades(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tradesRef = collection(this.firestore, 'trades');
      getDocs(tradesRef).then((querySnapshot) => {
        const firestoreTrades = querySnapshot.docs.map(doc => doc.data()['rowData']);
        // Don't overwrite existing tableData, merge with MT5 trades
        if (this.mt5LiveTrades.length > 0) {
          // Keep MT5 trades and add Firestore trades
          this.tableData = [...this.mt5LiveTrades, ...firestoreTrades];
        } else {
          this.tableData = firestoreTrades;
        }

        resolve(); // Notify that loading is done
      }).catch((error) => {
        console.warn('���️ Firestore connection issue - operating in offline mode:', error.message);
        // Continue with existing data or empty array
        if (this.mt5LiveTrades && this.mt5LiveTrades.length > 0) {
          this.tableData = [...this.mt5LiveTrades];
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
    this.http.post(`${this.BACKEND_URL_NOTION}/api/getAllPagesFromDB`, body)
    .subscribe({
      next: async (res:any) => {
        this.trades = [];
        res.results.map((prop: any) => {
          const d = new Date(prop.properties.Date.date.start);
          const dayOfWeek = d.getDay();
          const hours = d.getHours();
          const minutes = d.getMinutes();
          // Skip weekends (0 = Sunday, 6 = Saturday)
          // AND exclude the notion entry if hh:mm = 00:00
          if (dayOfWeek !== 0 && dayOfWeek !== 6 && hours !== 0 && minutes !== 0)  {
            this.trades.push({ tradeDate: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`, 
            tradeId: prop.id });
          }
        });
        const total = this.trades.length;
        let completed = 0;

        for (const trade of this.trades) {
          let relationId
          try {
             relationId = this.relations.filter(rel => rel.relationName === trade.tradeDate)[0].relationId
            
          } catch (error) {
          }
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
              this.http.patch(`${this.BACKEND_URL_NOTION}/api/patchRelationIdToTrade`, body) //Patching
            );
            if (res) {
            }else{
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
            this.http.post(`${this.BACKEND_URL_NOTION}/api/getRelationName`, body)
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
          completed++;
          this.progressChecking = Math.floor((completed / total) * 100);
          
          // await this.delay(300); // optional
        } catch (error) {   
          this.checkingError = true      
          console.error('Error checking relation for', date, error);
        }
    }
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
      this.http.post(`${this.BACKEND_URL_NOTION}/api/createRelationId`, body)
    );
    if (res) {
      // this.relations = []
      this.relations.push({ relationName: dateName, relationId: res.id })
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
              { "name": this.selectedAccount?.name ?? '' }
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
      this.http.post(`${this.BACKEND_URL_NOTION}/api/createNewEntry`, body)
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
        this.http.post(`${this.BACKEND_URL_NOTION}/api/getAllPagesFromDB`, body)
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
            this.http.patch(`${this.BACKEND_URL_NOTION}/api/updatePropertiesToTrade`, body)
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
          this.http.post(`${this.BACKEND_URL_NOTION}/api/getAllPagesFromDB`, body)
        );
        if (res.results && res.results.length > 0) {
          // console.log("Matched found: "+res.results[0].properties["Daily Reflection 📆"])
          row.tradeNotion = [{tradeDate: "", tradeId: res.results[0].id}];
          row.status = "Matched"
          console.log('✅ Match found for', originalDateStr, '- Status:', row.status);
        }else{
          row.status = "Unmatched"
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
      this.http.post(`${this.BACKEND_URL_NOTION}/api/getAllPagesFromDB`, body));

    const tradesFoundForUnmatched:Trades[] = []
     if (res.results && res.results.length > 0) {
        res.results.map((prop: any) => {
          const d = new Date(prop.properties.Date.date.start);
          const hh = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          tradesFoundForUnmatched.push({ tradeDate: `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.${d.getFullYear()} ${hh}:${min}`, 
          tradeId: prop.id })
        });
      }else{
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
    // const propFirmAccountValue = 5000; //change this in the future to read the excel file
    if (allMatched) {
      for (const trade of this.tableData) {
          const percentPnLTemp = (parseFloat(trade.netProfit) / this.mt5AccountInfo.startingBalance) * 100; // Assuming 5000 is the base value for PnL percentage calculation
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
              this.http.patch(`${this.BACKEND_URL_NOTION}/api/updatePropertiesToTrade`, body)
            );
            if (res) {
            }
            completed++;
            this.progressPopulating = Math.floor((completed / total) * 100);
          } catch (error) {
            this.populatingError = true
            console.error('Error populating data for', error);
          }
      }

    } else {
    }
  }

  async getMt5API(): Promise<any[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<any[]>(`${this.BACKEND_URL_MT5}/api/history`)
      );
      return Array.isArray(response) ? response : [];
    } catch (error) {
      console.warn('MT5 history unavailable; using Supabase trade history.', error);
      return [];
    }
  }

  async sendNotif(token: string, title: string, body: string): Promise<void> {
    try {
      const token = localStorage.getItem('fcm_token');
      if (!token) {
        console.warn('⚠No FCM token available for notification');
        return;
      }

      const payload = {
        "token": token,
        "title": title,
        "body": body,
      };

      const res: any = await firstValueFrom(
        this.http.post(`${this.BACKEND_URL_NOTION}/api/sendNotif`, payload)
      );

      if (res) {
      }
    } catch (error) {
      console.error('��� Error sending notification:', error);
    }
  }

  async loadNotionPerformanceData(): Promise<void> {
    this.isLoadingNotionData = true;
    try {
      // Check if backend is running first
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


      while (hasMore) {
        pageCount++;

        // Build request body for pagination
        const body: any = {};
        if (startCursor) {
          body.start_cursor = startCursor;
        }

        // Use the proxy endpoint that matches your database ID exactly
        const proxyResponse: any = await firstValueFrom(
          this.http.post(`${this.BACKEND_URL_NOTION}/api/getAllPagesFromDB`, body)
        );

        if (proxyResponse && proxyResponse.results && proxyResponse.results.length > 0) {
          // Add results from this page to our collection
          allResults = allResults.concat(proxyResponse.results);
          // Check if there are more pages
          hasMore = proxyResponse.has_more === true;
          startCursor = proxyResponse.next_cursor || null;

        } else {
          hasMore = false;
        }

        // Safety check to prevent infinite loops
        if (pageCount > 50) {
          console.warn('⚠️ Stopped pagination after 50 pages to prevent infinite loop');
          break;
        }
      }

      if (allResults.length > 0) {
        this.notionPerformanceData = this.parseNotionResponse(allResults);
 
      } else {
        console.warn('⚠��� No results found in your Notion database after pagination');
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
      this.cdr.markForCheck();
    }
  }



  // Generate stunning chart data with realistic trading patterns
  generateTradingChartData(): void {
    const startingBalance = this.mt5AccountInfo?.startingBalance ?? 0;
    const dailyLimitPercent = this.mt5AccountInfo?.dailyLossLimit ?? 0;
    const chartRange = Math.max(startingBalance * 0.1, 1);
    const chartOptions = this.chartOptions as any;
    this.chartOptions = {
      ...chartOptions,
      scales: {
        ...chartOptions.scales,
        y: {
          ...chartOptions.scales.y,
          min: startingBalance - chartRange,
          max: startingBalance + chartRange,
          ticks: {
            ...chartOptions.scales.y.ticks,
            stepSize: undefined,
            count: 10,
            maxTicksLimit: 10
          }
        }
      }
    };
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

    if (this.isDailyChart) {
      const dayMap = new Map<string, { pnl: number; date: Date }>();
      sortedTrades.forEach(trade => {
        const d = new Date(trade.openDate || '');
        if (isNaN(d.getTime())) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const pnl = parseFloat(trade.netProfit || '0');
        if (!dayMap.has(key)) {
          dayMap.set(key, { pnl: pnl, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()) });
        } else {
          const prev = dayMap.get(key)!;
          prev.pnl += pnl;
        }
      });

      const daily = Array.from(dayMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
      daily.forEach(day => {
        currentBalance += day.pnl;
        cumulativePnL += day.pnl;
        if (currentBalance > peakBalance) peakBalance = currentBalance;
        const drawdown = ((peakBalance - currentBalance) / peakBalance) * 100;
        const dateLabel = day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        labels.push(`${dateLabel}`);
        balanceData.push(currentBalance);
        pnlData.push(cumulativePnL);
        drawdownData.push(drawdown);
      });
    } else {
      // Process each trade for chart progression
      sortedTrades.forEach((trade, index) => {
        const tradeProfit = parseFloat(trade.netProfit || '0');
        currentBalance += tradeProfit;
        cumulativePnL += tradeProfit;

        if (currentBalance > peakBalance) {
          peakBalance = currentBalance;
        }

        const drawdown = ((peakBalance - currentBalance) / peakBalance) * 100;

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
    }

    const dailyLimitBalance = currentBalance * (1 - dailyLimitPercent / 100);

    // If no trades, show empty chart with starting balance and reference lines
    if (sortedTrades.length === 0) {
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
            pointBorderColor: 'transparent',
            pointBorderWidth: 0,
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
            label: `Daily Limit (${this.mt5AccountInfo.dailyLossLimit}%)`,
            data: [dailyLimitBalance],
            borderColor: '#F59E0B',
            backgroundColor: 'transparent',
            borderWidth: 2,
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
          pointBorderColor: 'transparent',
          pointBorderWidth: 0,
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
          label: `Daily Limit (${this.mt5AccountInfo.dailyLossLimit}%)`,
          data: new Array(labels.length).fill(dailyLimitBalance),
          borderColor: '#F59E0B',
          backgroundColor: 'transparent',
          borderWidth: 2,
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
          label: '���� --- Starting Balance',
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

    // Trigger chart update with animation
    if (this.chart) {
      this.chart.update('active');
    }

    // Trigger change detection to update chart display
    this.cdr.markForCheck();
  }


  private parseNotionResponse(results: any[]): NotionPerformanceData[] {
    if (!Array.isArray(results)) {
      console.error('❌ Results is not an array:', results);
      return [];
    }

    if (results.length === 0) {
      return [];
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
          screenshotUrls: this.getNotionFileUrls(properties, 'Screenshots'),
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

  private getNotionFileUrls(properties: any, propertyName: string): string[] {
    const files = properties[propertyName]?.files;
    if (!Array.isArray(files)) return [];

    return files
      .map((file: any) => file.type === 'file' ? file.file?.url : file.external?.url)
      .filter((url: unknown): url is string => typeof url === 'string' && url.length > 0);
  }

  private getNotionProperty(properties: any, propertyName: string, type: string): any {
    try {
      const property = properties[propertyName];
      if (!property) {
        return null;
      }


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
      const quickTestBody = {}; // Empty body as per your specification

      await firstValueFrom(
        this.http.post(`${this.BACKEND_URL_NOTION}/api/getAllPagesFromDB`, quickTestBody, {
          headers: { 'Cache-Control': 'no-cache' }
        })
      );

      return true;

    } catch (error: any) {
      // If it's a 404 with GET, but we're using POST now, so any response means server is up
      if (error.status === 404) {
        return false;
      }

      // If it's any other error but not connection error, server might be running
      if (error.status && error.status !== 0) {
        return true; // Server is running, just has issues
      }

      return false;
    }
  }

  checkBackendInstructions(): void {
    const instructions = `
        ��� How to start the Notion backend server:

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

    try {
      console.log('Testing POST request to /api/getAllPagesFromDB with empty body...');

      // Use the exact API request format you provided - empty JSON object
      const testBody = {}; // Empty body as per your sample request

      const testResponse = await firstValueFrom(
        this.http.post(`${this.BACKEND_URL_NOTION}/api/getAllPagesFromDB`, testBody)
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

  private getDistinctTradeDaysCount(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    const validDates = this.tableData
      .map(t => new Date(t.openDate || ''))
      .filter(d => d instanceof Date && !isNaN(d.getTime()))
      .map(d => d.toDateString());
    return new Set(validDates).size;
  }

  calculateTradesPerDayAvg(): number {
    const days = this.getDistinctTradeDaysCount();
    const trades = this.getTotalTrades();
    if (days === 0 || trades === 0) return 0;
    return trades / days;
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
    return this.mt5AccountInfo?.startingBalance ?? 0;
  }

  calculateAvgTradeDuration(): string {
    const minutes = this.calculateAvgTradeDurationMinutes();
    return this.formatMinutesToDuration(minutes);
  }

  calculateAvgTradeDurationMinutes(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    let totalMinutes = 0;
    let validTrades = 0;

    this.tableData.forEach(trade => {
      if (trade.openDate && trade.closeDate && trade.closeDate !== '-' && trade.closeDate.trim() !== '') {
        const holdTimeStr = this.calculateHoldTime(trade.openDate, trade.closeDate);
        if (holdTimeStr && holdTimeStr !== '') {
          const minutes = this.parseHoldTimeToMinutes(holdTimeStr);
          if (minutes > 0) {
            totalMinutes += minutes;
            validTrades++;
          }
        }
      }
    });

    if (validTrades === 0) return 0;
    return Math.floor(totalMinutes / validTrades);
  }

  calculateAvgLosingTradeDurationMinutes(): number {
    if (!this.tableData || this.tableData.length === 0) return 0;
    let totalMinutes = 0;
    let validTrades = 0;

    this.tableData.forEach(trade => {
      const netProfit = parseFloat(trade.netProfit) || 0;
      if (netProfit < 0 && trade.openDate && trade.closeDate && trade.closeDate !== '-' && trade.closeDate.trim() !== '') {
        const holdTimeStr = this.calculateHoldTime(trade.openDate, trade.closeDate);
        if (holdTimeStr && holdTimeStr !== '') {
          const minutes = this.parseHoldTimeToMinutes(holdTimeStr);
          if (minutes > 0) {
            totalMinutes += minutes;
            validTrades++;
          }
        }
      }
    });

    if (validTrades === 0) return 0;
    return Math.floor(totalMinutes / validTrades);
  }

  calculateAvgLosingTradeDuration(): string {
    const minutes = this.calculateAvgLosingTradeDurationMinutes();
    return this.formatMinutesToDuration(minutes) || 'No data';
  }

  getDurationBarHeight(valueMinutes: number, overallMinutes: number, losingMinutes: number): number {
    const maxVal = Math.max(overallMinutes || 0, losingMinutes || 0);
    if (!valueMinutes || maxVal === 0) return 20;
    return Math.max(20, (valueMinutes / maxVal) * 80);
  }

  private formatMinutesToDuration(avgMinutes: number): string {
    if (!avgMinutes || avgMinutes <= 0) return '0min';
    const hours = Math.floor(avgMinutes / 60);
    const remainingMinutes = avgMinutes % 60;
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
    const accountSize = this.mt5AccountInfo?.startingBalance || this.calculateAccountSize() || 2500;

    if (avgWin <= 0 || accountSize <= 0) return 0;

    return (avgWin / accountSize) * 100;
  }

  calculateAvgLossPercentage(): number {
    const avgLoss = Math.abs(this.calculateAvgLoss());
    const accountSize = this.mt5AccountInfo?.startingBalance || this.calculateAccountSize() || 2500;

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
    if (!this.tableData || this.tableData.length === 0) {
      if (this.tableData && this.tableData.length === 0) {
       
      }
      return 0;
    }

    const grossProfit = this.tableData
      .filter(trade => (parseFloat(trade.netProfit) || 0) > 0)
      .reduce((total, trade) => total + (parseFloat(trade.netProfit) || 0), 0);

    const grossLoss = Math.abs(this.tableData
      .filter(trade => (parseFloat(trade.netProfit) || 0) < 0)
      .reduce((total, trade) => total + (parseFloat(trade.netProfit) || 0), 0));

    if (grossLoss === 0) {
  
      return grossProfit > 0 ? 999 : 0;
    }

    const result = parseFloat((grossProfit / grossLoss).toFixed(2));
   
    return result;
  }

  calculateBestProfit(): number {
    if (!this.tableData || this.tableData.length === 0) {
      // Return demo data when no trades exist
      return 125.50;
    }

    const profits = this.tableData.map(trade => parseFloat(trade.netProfit) || 0);
    return Math.max(...profits, 0);
  }

  calculateBestProfitPercentage(): number {
    const bestProfit = this.calculateBestProfit();
    const accountSize = this.mt5AccountInfo?.startingBalance || this.calculateAccountSize() || 2500;

    if (bestProfit <= 0 || accountSize <= 0) return 0;

    return (bestProfit / accountSize) * 100;
  }

  calculateBestLoss(): number {
    if (!this.tableData || this.tableData.length === 0) {
      // Return demo data when no trades exist
      return -87.25;
    }

    const losses = this.tableData
      .map(trade => this.getSafeNumber(trade.netProfit))
      .filter(profit => profit < 0);
    return losses.length > 0 ? Math.min(...losses) : 0;
  }

  calculateBestLossPercentage(): number {
    const bestLoss = Math.abs(this.calculateBestLoss());
    const accountSize = this.mt5AccountInfo?.startingBalance || this.calculateAccountSize() || 2500;

    if (bestLoss <= 0 || accountSize <= 0) return 0;

    return (bestLoss / accountSize) * 100;
  }

  // Chart data for Best Profit/Loss visualization
  // (Removed unused profit/loss chart helpers)

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

      const dayName = news.date.trim().split(/[\s,]+/)[0].slice(0, 3).toLowerCase();
      const dayMap: { [key: string]: number } = {
        mon: 1,
        tue: 2,
        wed: 3,
        thu: 4,
        fri: 5
      };

      return dayMap[dayName] === dayNumber;
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

  getEnhancedNewsClasses(news: any): any {
    const impact = this.getNewsImpact(news);

    return {
      'high-impact': impact === 'High',
      'medium-impact': impact === 'Medium',
      'low-impact': impact === 'Low',
      'news-ended': this.isNewsEnded(news)
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


  selectEmotionForTrade(trade: Table, emotion: any) {
    const tradeKey = this.getTradeKey(trade);
    this.initializeTradeEmotionalState(trade);
    this.tradeEmotionalStates[tradeKey].selectedEmotion = emotion.name;
    this.tradeEmotionalStates[tradeKey].customEmotion = ''; // Clear custom if predefined is selected
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
    const initialBalance = 2500; // Prop firm account value
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

  // Helper methods for Profit Factor visual marker
  getProfitFactorNumeric(): number {
    const pf = this.calculateProfitFactor();
    if (!isFinite(pf) || isNaN(pf)) return 0;
    return pf;
  }

  getProfitFactorX(): number {
    // Map [0, 3+] -> [0, 180] (viewBox width)
    const clamped = Math.max(0, Math.min(this.getProfitFactorNumeric(), 3));
    return clamped * 60; // 180 / 3 = 60
  }

  getProfitFactorMarkerColor(): string {
    const pf = this.getProfitFactorNumeric();
    if (pf >= 2.5) return '#065f46';
    if (pf >= 2.0) return '#059669';
    if (pf >= 1.5) return '#10b981';
    if (pf >= 1.0) return '#22c55e';
    if (pf >= 0.5) return '#f59e0b';
    if (pf > 0) return '#ef4444';
    return '#e2e8f0';
  }

  getProfitFactorTier(): string {
    const pf = this.getProfitFactorNumeric();
    if (!isFinite(pf) || isNaN(pf)) return 'N/A';
    if (pf >= 2.5) return 'Elite';
    if (pf >= 2.0) return 'Outstanding';
    if (pf >= 1.5) return 'Excellent';
    if (pf >= 1.0) return 'Good';
    if (pf >= 0.5) return 'Concerning';
    if (pf > 0) return 'Poor';
    return 'Zero';
  }

  getProfitFactorLabel(): string {
    const pf = this.getProfitFactorNumeric();
    if (!isFinite(pf) || isNaN(pf)) return 'PF 0.00 — Zero';
    const capped = pf > 3 ? '3.00+' : pf.toFixed(2);
    return `PF ${capped} — ${this.getProfitFactorTier()}`;
  }

  getProfitFactorLabelX(): number {
    const x = this.getProfitFactorX();
    return Math.max(15, Math.min(165, x));
  }

  getProfitFactorTextAnchor(): 'start' | 'middle' | 'end' {
    const x = this.getProfitFactorX();
    if (x <= 25) return 'start';
    if (x >= 155) return 'end';
    return 'middle';
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
        title: '�� Low Win Rate Detected',
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
  //         console.log("���� Preserving existing MT5 trades:", this.mt5LiveTrades.length);
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

  async syncImportedMt5Trades(): Promise<void> {
    if (this.isSyncingMT5Trades || !this.mt5ImportedTrades.length) return;

    const account = this.accounts.find(item => item.id === this.mt5SyncAccountId);
    if (!account) {
      this.mt5SyncStatus = 'error';
      this.mt5SyncStatusMessage = 'Choose a Supabase account before syncing.';
      this.snackBar.open('Choose a Supabase account before syncing.', 'Dismiss', { duration: 5000 });
      return;
    }

    this.isSyncingMT5Trades = true;
    this.mt5SyncStatus = 'syncing';
    this.mt5SyncProgress = 5;
    this.mt5SyncProcessed = 0;
    this.mt5SyncTotal = this.mt5ImportedTrades.length;
    this.mt5SyncCreated = 0;
    this.mt5SyncUpdated = 0;
    this.mt5SyncStatusMessage = `Preparing ${this.mt5SyncTotal} trades for ${account.name}...`;
    this.cdr.markForCheck();
    try {
      const trades = this.mt5ImportedTrades.map(trade => this.mapMt5TradeForSupabase(trade));
      this.mt5SyncProgress = 10;
      this.mt5SyncStatusMessage = `Matching tickets and syncing to ${account.name}...`;
      this.cdr.markForCheck();
      const { created, updated } = await this.supabaseService.syncTradesToAccount(
        trades,
        account.id,
        (processed, total, createdCount, updatedCount) => {
          this.mt5SyncProcessed = processed;
          this.mt5SyncTotal = total;
          this.mt5SyncCreated = createdCount;
          this.mt5SyncUpdated = updatedCount;
          this.mt5SyncProgress = 10 + Math.round((processed / total) * 85);
          this.mt5SyncStatusMessage = `Synced ${processed} of ${total} trades to ${account.name}.`;
          this.cdr.markForCheck();
        }
      );
      this.mt5SyncStatus = 'success';
      this.mt5SyncProgress = 100;
      this.mt5SyncProcessed = this.mt5SyncTotal;
      this.mt5SyncCreated = created;
      this.mt5SyncUpdated = updated;
      this.mt5SyncStatusMessage = `Sync complete: ${created} created, ${updated} updated in ${account.name}.`;
      this.snackBar.open(`${created} imported trade${created === 1 ? '' : 's'} created, ${updated} updated in ${account.name}.`, 'Dismiss', { duration: 5000 });
    } catch (error) {
      console.error('Failed to sync imported MT5 trades to Supabase:', error);
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      this.mt5SyncStatus = 'error';
      this.mt5SyncStatusMessage = `Sync failed after ${this.mt5SyncProcessed} of ${this.mt5SyncTotal} trades: ${message}`;
      this.snackBar.open(`Import sync failed: ${message}`, 'Dismiss', { duration: 8000 });
    } finally {
      this.isSyncingMT5Trades = false;
      this.cdr.markForCheck();
    }
  }

  dismissMt5SyncStatus(): void {
    if (this.isSyncingMT5Trades) return;
    this.mt5SyncStatus = 'idle';
    this.mt5SyncStatusMessage = '';
    this.cdr.markForCheck();
  }

  async syncMT5Trades(): Promise<void> {
    if (this.isSyncingMT5Trades) return;

    this.isSyncingMT5Trades = true;
    try {
      await this.loadMT5Data();
      const trades = this.mt5LiveTrades
        .filter(trade => trade.position !== undefined && trade.position !== null && trade.position !== '')
        .map(trade => this.mapMt5TradeForSupabase(trade));
      if (!this.selectedAccount) {
        throw new Error('Select an account before syncing MT5 trades.');
      }
      const { created, updated } = await this.supabaseService.syncMt5Trades(trades, this.selectedAccount.name);

      this.snackBar.open(`MT5 sync complete: ${created} created, ${updated} updated.`, 'Dismiss', {
        duration: 4000,
        verticalPosition: 'top',
        horizontalPosition: 'right',
        panelClass: ['account-notification', 'notification-success']
      });
    } catch (error) {
      console.error('Failed to sync MT5 trades to Supabase:', error);
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      this.snackBar.open(`MT5 sync failed: ${message}`, 'Dismiss', { duration: 8000 });
    } finally {
      this.isSyncingMT5Trades = false;
      this.cdr.markForCheck();
    }
  }

  private mapMt5TradeForSupabase(trade: Table): Partial<Trade> {
    return {
      ticket: trade.position,
      buy_sell: trade.type.toLowerCase() === 'buy' ? 'Buy' : 'Sell',
      commission: this.toNumber(trade.commission),
      time_open: this.formatMt5DateForSupabase(trade.openDate),
      time_close: trade.closeDate === '-' ? undefined : this.formatMt5DateForSupabase(trade.closeDate),
      instrument: trade.symbol,
      lots: this.toNumber(trade.volume),
      pnl: this.toNumber(trade.netProfit),
      price_close: trade.exit === '-' ? undefined : this.toNumber(trade.exit),
      price_open: this.toNumber(trade.entry),
      risk_per_trade: this.toNumber(trade.riskPerTrade),
      rrr: trade.rrr,
      sl: this.toNumber(trade.sL),
      swap: this.toNumber(trade.swap),
      tp: this.toNumber(trade.tP)
    };
  }

  private formatMt5DateForSupabase(date: string): string | undefined {
    if (!date || date === '-') return undefined;

    const yearFirstMatch = date.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
    if (yearFirstMatch) {
      const [, year, month, day, hour, minute] = yearFirstMatch;
      return `${year}-${month}-${day}T${hour}:${minute}:00`;
    }

    const monthFirstMatch = date.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
    if (!monthFirstMatch) return undefined;

    const [, month, day, year, hour, minute] = monthFirstMatch;
    return `${year}-${month}-${day}T${hour}:${minute}:00`;
  }

  private toNumber(value: string | number): number {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  async loadMT5Data(): Promise<void> {
    const loadVersion = ++this.mt5DataLoadVersion;
    const accountId = this.selectedAccount?.id ?? null;
    this.isLoadingMT5Data = true;
    let response: any[] = [];

    try {
      const [supabaseTrades, mt5History] = await Promise.all([
        this.getSupabaseTrades(),
        this.getMt5API()
      ]);
      this.mt5OpenPositionIds = mt5History.length > 0
        ? new Set(
            this.isActiveMt5Account()
              ? mt5History
                  .filter((trade: any) => String(trade?.status).toLowerCase() === 'open')
                  .map((trade: any) => String(trade.position_id))
              : []
          )
        : null;
      response = this.reconcileMt5Statuses(supabaseTrades, mt5History);
      console.log('🗄️ Supabase history loaded:', response.length, 'trades');
    } finally {
      if (loadVersion === this.mt5DataLoadVersion) {
        this.isLoadingMT5Data = false;
        this.cdr.markForCheck();
      }
    }

    if (loadVersion !== this.mt5DataLoadVersion || accountId !== (this.selectedAccount?.id ?? null)) return;

    // Map the trades once, regardless of source
    console.log('🔄 Mapping trades from response:', response?.length ?? 0, 'items');
    const mt5Trades = (response || []).map((trade: any) => ({
      openDate: this.convertAndFormatMT5Date(trade.time_open, !trade.fromSupabase),
      closeDate: trade.time_close ? this.convertAndFormatMT5Date(trade.time_close, !trade.fromSupabase) : "-",
      tradeNotion: [],
      status: "",
      position: trade.position_id,
      symbol: trade.symbol || '',
      type: trade.trade_type === 0 ? 'Buy' : 'Sell',
      volume: trade.volume ? trade.volume.toString() : '0',
      entry: trade.entry_price ? +parseFloat(trade.entry_price).toFixed(5) : '0',
      sL: trade.sl ? trade.sl.toString() : '0',
      tP: trade.tp ? trade.tp.toString() : '0',
      exit: trade.exit_price ? trade.exit_price.toString() : '0',
      commission: trade.commission ? trade.commission.toString() : '0',
      swap: trade.swap ? trade.swap.toString() : '0',
      profit: trade.profit ? trade.profit.toString() : '0',
      netProfit: (trade.profit + trade.commission).toString(),
      riskPerTrade: trade.risk_usd ? trade.risk_usd.toString() : '0',
      rrr: trade.reward_risk_ratio ? trade.reward_risk_ratio.toString() : '0',
      mt5status: trade.status || '',
      mfe: (trade.mfe ?? 0).toString(),
      mae: (trade.mae ?? 0).toString(),
      screenshotUrl: trade.screenshot_url || this.getCachedTradeScreenshot(trade.position_id),
      screenshotUrls: trade.screenshot_url ? [trade.screenshot_url] : []
    } as Table));

    this.mt5LiveTrades = mt5Trades;
    this.recentlyAddedTrades = mt5Trades.filter(trade => this.mt5OpenPositionIds?.has(String(trade.position)));
    console.log("✅ mt5LiveTrades updated:", this.mt5LiveTrades.length, 'trades');
    console.log("📊 Sample trade netProfit:", mt5Trades[0]?.netProfit);

    this.updateTableData();



    // Generate stunning chart with loaded data
    // setTimeout(() => {
      // this.generateTradingChartData();
    // }, 500);

    // Go to last page of the table to show the latest trade
    try {
      this.setPage(this.getTotalPages());
    } catch (error) {
      console.error('Error setting page:', error);
    }
  }

  
  getCurrentMt5LiveTrades(): Table[] {
    if (!this.mt5OpenPositionIds) {
      return this.mt5LiveTrades.filter(trade => String(trade.mt5status).toLowerCase() === 'open' || !trade.closeDate || trade.closeDate === '-');
    }
    return this.mt5LiveTrades.filter(trade => this.mt5OpenPositionIds?.has(String(trade.position)));
  }

  private reconcileMt5Statuses(supabaseTrades: any[], mt5History: any[]): any[] {
    const mt5ByPosition = new Map(
      (mt5History || [])
        .filter(trade => trade?.position_id !== undefined && trade?.position_id !== null)
        .map(trade => [String(trade.position_id), trade])
    );

    return supabaseTrades.map(trade => {
      const mt5Trade = mt5ByPosition.get(String(trade.position_id));
      if (!mt5Trade || String(mt5Trade.status).toLowerCase() === 'open') return trade;

      return {
        ...trade,
        status: mt5Trade.status,
        time_close: mt5Trade.time_close || trade.time_close,
        exit_price: mt5Trade.exit_price || trade.exit_price,
        profit: mt5Trade.profit ?? trade.profit,
        commission: mt5Trade.commission ?? trade.commission,
        swap: mt5Trade.swap ?? trade.swap
      };
    });
  }

  private async getSupabaseTrades(): Promise<any[]> {
    if (!this.selectedAccount) return [];
    const trades = await this.supabaseService.getAllTrades(this.selectedAccount.id);

    return trades
      .filter((trade): trade is Trade & { time_open: string } => Boolean(trade.time_open))
      .map(trade => ({
        commission: trade.commission ?? 0,
        entry_price: trade.price_open ?? 0,
        exit_price: trade.price_close ?? 0,
        position_id: trade.ticket ?? '',
        profit: trade.pnl ?? 0,
        reward_risk_ratio: trade.rrr ?? '',
        risk_usd: trade.risk_per_trade ?? 0,
        sl: trade.sl ?? 0,
        status: trade.time_close ? 'closed' : 'open',
        symbol: trade.instrument ?? '',
        time_open: this.formatSupabaseDateForMt5(trade.time_open),
        time_close: trade.time_close ? this.formatSupabaseDateForMt5(trade.time_close) : '',
        tp: trade.tp ?? 0,
        trade_type: trade.buy_sell === 'Buy' ? 0 : 1,
        volume: trade.lots ?? 0,
        swap: trade.swap ?? 0,
        mfe: trade.mfe ?? 0,
        mae: trade.mae ?? 0,
        fromSupabase: true
      }));
  }

  private formatSupabaseDateForMt5(date: string): string {
    return date.replace('T', ' ').replace(/\.\d+(Z)?$/, '').replace(/Z$/, '');
  }


  convertAndFormatMT5Date(rawDateStr: string, adjustTimezone = true): string { // MT5 API date format -> time_close: "2025-07-24 09:56:01"
    const [datePart, timePart] = rawDateStr.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = timePart.split(':').map(Number);

    const dateObj = new Date(year, month - 1, day, hour, minute, second);
    if (adjustTimezone) {
      dateObj.setHours(dateObj.getHours() + 5);
    }

    return `${String(dateObj.getMonth() + 1).padStart(2, '0')}.${String(dateObj.getDate()).padStart(2, '0')}.${dateObj.getFullYear()} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
  }

  

  simulateMFEUpdates(ticket: number): void {
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

      this.updateMT5TradePrice(priceUpdateData);

      if (updateCount >= maxUpdates) {
        clearInterval(interval);
      }
    }, 1000); // Update every second for demo
  }

  

  private getCachedTradeScreenshot(ticket: number | string): string {
    try {
      const cache = JSON.parse(localStorage.getItem(this.tradeScreenshotStorageKey) || '{}');
      return typeof cache?.[String(ticket)] === 'string' ? cache[String(ticket)] : '';
    } catch {
      return '';
    }
  }

  private cacheTradeScreenshot(ticket: number | string, screenshotUrl: string): void {
    try {
      const cache = JSON.parse(localStorage.getItem(this.tradeScreenshotStorageKey) || '{}');
      cache[String(ticket)] = screenshotUrl;
      localStorage.setItem(this.tradeScreenshotStorageKey, JSON.stringify(cache));
    } catch {
      return;
    }
  }

  hasScreenshotLoadError(ticket: number | string): boolean {
    return this.screenshotLoadErrors.has(String(ticket));
  }

  onScreenshotLoadError(ticket: number | string): void {
    this.screenshotLoadErrors.add(String(ticket));
    this.cdr.markForCheck();
  }

  private normalizeAccountNumber(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private isActiveMt5Account(): boolean {
    const selectedAccountNumber = this.normalizeAccountNumber(this.selectedAccount?.account_number);
    return Boolean(selectedAccountNumber && this.mt5AccountLogin && selectedAccountNumber === this.mt5AccountLogin);
  }

  private getLiveExtremesCache(): Record<string, Record<string, { mfe: number; mae: number }>> {
    try {
      localStorage.removeItem(this.legacyLiveExtremesStorageKey);
      const cached = JSON.parse(localStorage.getItem(this.liveExtremesStorageKey) || '{}');
      return cached && typeof cached === 'object' ? cached : {};
    } catch {
      return {};
    }
  }

  private getLiveExtremes(ticket: number | string): { mfe: number; mae: number } {
    const accountId = this.selectedAccount?.id;
    const cached = accountId ? this.getLiveExtremesCache()[accountId]?.[String(ticket)] : undefined;
    return {
      mfe: Number.isFinite(Number(cached?.mfe)) ? Number(cached?.mfe) : 0,
      mae: Number.isFinite(Number(cached?.mae)) ? Number(cached?.mae) : 0
    };
  }

  private queueLiveExtremesCacheWrite(): void {
    if (this.liveExtremesCacheTimer) return;
    this.liveExtremesCacheTimer = window.setTimeout(() => {
      this.liveExtremesCacheTimer = undefined;
      const accountId = this.selectedAccount?.id;
      if (!accountId) return;
      const cache = this.getLiveExtremesCache();
      const accountCache = cache[accountId] ?? {};
      for (const trade of this.mt5LiveTrades) {
        if (trade.closeDate && trade.closeDate !== '-') continue;
        accountCache[String(trade.position)] = {
          mfe: Number(trade.mfe) || 0,
          mae: Number(trade.mae) || 0
        };
      }
      cache[accountId] = accountCache;
      localStorage.setItem(this.liveExtremesStorageKey, JSON.stringify(cache));
    }, 3000);
  }

  private clearLiveExtremes(ticket: number | string): void {
    const accountId = this.selectedAccount?.id;
    if (!accountId) return;
    const cache = this.getLiveExtremesCache();
    delete cache[accountId]?.[String(ticket)];
    if (cache[accountId] && Object.keys(cache[accountId]).length === 0) {
      delete cache[accountId];
    }
    localStorage.setItem(this.liveExtremesStorageKey, JSON.stringify(cache));
  }

  private async persistClosedTradeExtremes(ticket: number | string, mfe: number, mae: number): Promise<void> {
    if (!this.selectedAccount) return;
    await this.supabaseService.updateTradeMfeMaeByTicket(ticket, this.selectedAccount.id, mfe, mae);
    this.clearLiveExtremes(ticket);
  }

  private async persistLiveTrade(trade: Table): Promise<void> {
    if (!this.selectedAccount) return;
    const tradeForSupabase = {
      ...this.mapMt5TradeForSupabase(trade),
      mfe: this.toNumber(trade.mfe),
      mae: this.toNumber(trade.mae ?? '0')
    };
    await this.supabaseService.saveTradeForAccount(tradeForSupabase, this.selectedAccount.id);
  }

  private async loadNewTradeScreenshot(trade: Table): Promise<void> {
    for (let attempt = 0; attempt < 15; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      try {
        const screenshotUrls = (await this.supabaseService.getTradeScreenshotUrls([trade.position]))[String(trade.position)] || [];
        if (!screenshotUrls.length) continue;

        trade.screenshotUrls = [...new Set([...(trade.screenshotUrls || []), ...screenshotUrls])];
        trade.screenshotUrl = trade.screenshotUrls[0];
        this.cacheTradeScreenshot(trade.position, trade.screenshotUrl);
        this.screenshotLoadErrors.delete(String(trade.position));
        this.mt5LiveTrades = [...this.mt5LiveTrades];
        this.updateTableData();
        this.cdr.markForCheck();
        return;
      } catch (error) {
        if (attempt === 14) {
          console.warn('Unable to load screenshot for new trade:', error);
        }
      }
    }
  }

  addMT5LiveTrade(tradeData: any): void {
    if (!this.isActiveMt5Account()) return;
    const trade = tradeData;
    if (!trade) return;
    const extremes = this.getLiveExtremes(trade.ticket);
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
      mfe: String(Math.max(extremes.mfe, Number(trade.mfe) || 0)),
      mae: String(Math.min(extremes.mae, Number(trade.mae) || 0)),
      screenshotUrl: trade.screenshot_url || this.getCachedTradeScreenshot(trade.ticket),
      screenshotUrls: trade.screenshot_url ? [trade.screenshot_url] : []
    };

    if (newTrade.screenshotUrl) {
      this.cacheTradeScreenshot(newTrade.position, newTrade.screenshotUrl);
    }

    const existingIndex = this.mt5LiveTrades.findIndex(t =>
      t.position === newTrade.position
    );
    console.log('🔄 Adding MT5 live trade:', newTrade, 'Existing index:', existingIndex);
    if (existingIndex == -1) {
      this.mt5LiveTrades = [...this.mt5LiveTrades, newTrade];
      this.mt5OpenPositionIds?.add(String(newTrade.position));
      console.log('🔴 mt5LiveTrades after add:', this.mt5LiveTrades.length);

      this.updateTableData();
      console.log('📊 tableData after update:', this.tableData.length);

      // Track as recently added for visual indication
      this.recentlyAddedTrades.unshift(newTrade);
      void this.loadNewTradeScreenshot(newTrade);

      // Remove from recent list after 5 seconds
      // setTimeout(() => {
      //   const index = this.recentlyAddedTrades.indexOf(newTrade);
      //   if (index > -1) {
      //     this.recentlyAddedTrades.splice(index, 1);
      //   }
      // }, 5000);

      // Update the beautiful chart with new data
      this.updateChartWithNewTrade(newTrade);
      this.notifyGaugePercentage(newTrade);

      // Force Angular change detection for immediate display
      this.cdr.detectChanges();

      // Go to last page of the table to show the latest trade
      this.setPage(this.getTotalPages());

      void this.persistLiveTrade(newTrade).catch(error => {
        console.error('Unable to persist opened trade:', error);
      });

    } else {
    }
  }

  // Close MT5 trade when closed
  closeMT5Trade(tradeData: any): void {
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
      const closingProfit = Number(trade.profit);
      const finalMfe = Math.max(Number(closedTrade.mfe) || 0, Number.isFinite(closingProfit) ? closingProfit : 0);
      const finalMae = Math.min(Number(closedTrade.mae) || 0, Number.isFinite(closingProfit) ? closingProfit : 0);
      closedTrade.mfe = String(finalMfe);
      closedTrade.mae = String(finalMae);
      this.stopGaugeAlert(String(trade.ticket));
      this.gaugeAlertNotifiedTickets.delete(String(trade.ticket));
      this.mt5OpenPositionIds?.delete(String(trade.ticket));
      this.recentlyAddedTrades = this.recentlyAddedTrades.filter(
        recentTrade => String(recentTrade.position) !== String(trade.ticket)
      );

      this.mt5LiveTrades[liveIndex] = closedTrade;
      this.mt5LiveTrades = [...this.mt5LiveTrades];

      void this.persistLiveTrade(closedTrade).catch(error => {
        console.error('Unable to persist closed trade:', error);
      });
      void this.persistClosedTradeExtremes(trade.ticket, finalMfe, finalMae).catch(error => {
        console.error('Unable to persist final MFE/MAE:', error);
      });

      // this.mt5LiveTrades.splice(liveIndex, 1);
      this.updateTableData();

      // Update the beautiful chart with closed trade
      this.updateChartWithClosedTrade(closedTrade);

    }
  }

  private notifyGaugePercentage(trade: Table): void {
    const accountSize = Number(this.mt5AccountInfo.startingBalance);
    const profit = Number.parseFloat(trade.profit) || 0;
    const gaugePercentage = accountSize > 0 ? (profit / accountSize) * 100 : 0;
    const ticket = String(trade.position);
    const { enabled, alertThreshold, highAlertThreshold, volume } = this.liveTradeSoundSettings;
    const isInAlertRange = enabled && Number.isFinite(gaugePercentage) && gaugePercentage >= alertThreshold && gaugePercentage < highAlertThreshold;
    const isAboveHighAlertRange = enabled && Number.isFinite(gaugePercentage) && gaugePercentage >= highAlertThreshold;
    const nextAlertLevel: 'normal' | 'high' | null = isAboveHighAlertRange
      ? 'high'
      : isInAlertRange
        ? 'normal'
        : null;

    if (!nextAlertLevel) {
      this.stopGaugeAlert(ticket);
      return;
    }

    const currentAlertLevel = this.activeGaugeAlertLevels.get(ticket);
    if (currentAlertLevel === nextAlertLevel) return;

    this.stopGaugeAlert(ticket);
    const soundMap = nextAlertLevel === 'high' ? this.highGaugeAlertSounds : this.gaugeAlertSounds;
    const sound = new Audio(nextAlertLevel === 'high' ? this.highGaugeAlertSoundUrl : this.gaugeAlertSoundUrl);
    sound.loop = true;
    sound.volume = volume;
    soundMap.set(ticket, sound);
    this.activeGaugeAlertLevels.set(ticket, nextAlertLevel);
    sound.play().catch(error => {
      this.stopGaugeAlert(ticket);
      console.warn('Unable to play gauge percentage alert sound:', error);
    });

    if (!this.gaugeAlertNotifiedTickets.has(ticket)) {
      this.gaugeAlertNotifiedTickets.add(ticket);
      this.snackBar.open(`${trade.symbol || 'Trade'} reached ${gaugePercentage.toFixed(2)}%`, 'Dismiss', { duration: 5000 });
    }
  }

  private stopGaugeAlert(ticket: string): void {
    this.activeGaugeAlertLevels.delete(ticket);
    for (const soundMap of [this.gaugeAlertSounds, this.highGaugeAlertSounds]) {
      const sound = soundMap.get(ticket);
      if (!sound) continue;
      sound.pause();
      sound.currentTime = 0;
      soundMap.delete(ticket);
    }
  }

  private stopAllGaugeAlerts(): void {
    const tickets = new Set([
      ...this.activeGaugeAlertLevels.keys(),
      ...this.gaugeAlertSounds.keys(),
      ...this.highGaugeAlertSounds.keys()
    ]);
    tickets.forEach(ticket => this.stopGaugeAlert(ticket));
  }

  updateMT5TradePrice(priceData: any): void {
    const livePositionId = priceData.ticket ?? priceData.position_id ?? priceData.position;
    const livePositionNumber = Number(livePositionId);
    const tradeIndex = this.mt5LiveTrades.findIndex(trade => {
      const tradePositionNumber = Number(trade.position);
      return Number.isFinite(livePositionNumber) && Number.isFinite(tradePositionNumber)
        ? tradePositionNumber === livePositionNumber
        : String(trade.position) === String(livePositionId);
    });

    if (tradeIndex !== -1) {
      const trade = this.mt5LiveTrades[tradeIndex];
      const currentProfit = priceData.profit ? parseFloat(priceData.profit.toString()) : 0;

      // Update current profit values
      trade.profit = priceData.profit ? priceData.profit.toString() : '0';
      trade.netProfit = priceData.profit ? priceData.profit.toString() : '0';
      this.notifyGaugePercentage(trade);

      if ((!trade.riskPerTrade || Number(trade.riskPerTrade) <= 0) && priceData.sl_value !== undefined) {
        trade.riskPerTrade = Math.abs(Number(priceData.sl_value)).toFixed(2);
      }

      const currentMfe = Number(trade.mfe) || 0;
      const currentMae = Number(trade.mae) || 0;
      trade.mfe = String(Math.max(currentMfe, currentProfit));
      trade.mae = String(Math.min(currentMae, currentProfit));
      this.queueLiveExtremesCacheWrite();

      this.mt5LiveTrades = [...this.mt5LiveTrades];
      this.updateTableDataOnly();

      // Add subtle chart pulse on price updates (every 10th update to avoid spam)
      if (Math.random() < 0.1) {
        const liveIndicator = document.querySelector('.live-indicator .pulse-dot');
        if (liveIndicator) {
          liveIndicator.classList.add('pulse-dot');
        }
      }
      return;
    }

    if (this.selectedAccount && livePositionId !== undefined && livePositionId !== null && livePositionId !== '') {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      this.addMT5LiveTrade({
        ...priceData,
        ticket: livePositionId,
        time_open: now,
        price_open: Number(priceData.price_open ?? priceData.price_current ?? 0),
        type: Number(priceData.type ?? priceData.trade_type ?? 0),
        volume: Number(priceData.volume ?? 0),
        profit: Number(priceData.profit ?? 0),
        risk_usd: Math.abs(Number(priceData.sl_value ?? priceData.risk_usd ?? 0)),
        status: 'open'
      });
    }
  }

  updateTableDataOnly(): void {
    this.tableData = [...this.mt5LiveTrades];

    this.updateDailyLimitMetrics();
    this.generateTradingChartData();
    this.checkForProfitTargetCelebration();

    this.cdr.detectChanges();
  }

  updateTableData(): void {
    console.log('������ Before update - tableData:', this.tableData ? this.tableData.length : 0);
    console.log('���� Before update - mt5LiveTrades:', this.mt5LiveTrades.length);

    const previousLength = this.tableData ? this.tableData.length : 0;
    this.tableData = [...this.mt5LiveTrades];

    // Recalculate Daily Limit metrics
    this.updateDailyLimitMetrics();

    console.log('✅ After update - tableData:', this.tableData.length, 'account-scoped trades');
    console.log('📊 Array reference changed:', previousLength !== this.tableData.length ? 'YES' : 'NO');

    // Set metrics loading to false when table data is updated
    this.isLoadingMetrics = false;
    this.generateTradingChartData();
    this.cdr.detectChanges();

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
    const accountSize = this.mt5AccountInfo?.balance || this.calculateAccountSize() || 2500; // Fallback to 5k
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
    const accountSize = this.mt5AccountInfo?.balance || this.calculateAccountSize() || 2500; // Fallback to 5k

    if (rrr <= 0 || riskAmount <= 0 || accountSize <= 0) {
      return '0.0';
    }

    const gainAmount = rrr * riskAmount;
    const gainPercentage = (gainAmount / accountSize) * 100;
    return gainPercentage.toFixed(1);
  }

  getMURPercentage(row: Table): string {
    // Calculate MUR percentage based on actual account size
    const accountSize = this.mt5AccountInfo?.balance || this.calculateAccountSize() || 2500; // Fallback to 5k
    const murAmount = this.getSafeNumber(row.mfe);

    if (murAmount <= 0 || accountSize <= 0) {
      return '0.0';
    }

    const percentage = (murAmount / accountSize) * 100;
    return percentage.toFixed(1);
  }

  getNetPnLPercentage(row: Table): string {
    // Calculate Net P&L percentage based on actual account size
    const accountSize = this.mt5AccountInfo?.balance || this.calculateAccountSize() || 2500; // Fallback to 5k
    const netPnL = this.getSafeNumber(row.netProfit);

    if (accountSize <= 0) {
      return '0.0';
    }

    const percentage = (netPnL / accountSize) * 100;
    return percentage.toFixed(1);
  }

  addRowDirectlyToDataTable(newTrade: Table): void {
    try {
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
        // Scroll to top to show the new row
        $('#myTable_wrapper .dataTables_scrollBody').scrollTop(0);

      }

    } catch (error) {
      console.error('❌ Error adding row directly to DataTable:', error);
    }
  }

  refreshDataTable(): void {
    try {
      // Use Angular binding refresh for complex columns
      this.refreshDataTableWithAngularBinding();

    } catch (error) {
      console.error('❌ Error refreshing DataTable:', error);
    }
  }

  forceDataTableRefresh(): void {
    // Method 1: Immediate change detection
    this.cdr.detectChanges();

    // Method 2: Nuclear option - completely rebuild the table
    setTimeout(() => {
      this.nuclearDataTableRebuild();
    }, 100);
  }

  nuclearDataTableRebuild(): void {
    try {
      // Step 1: Completely destroy existing DataTable
      if ($.fn.dataTable.isDataTable('#myTable')) {
        $('#myTable').DataTable().destroy();
        $('#myTable').empty(); // Clear all HTML content
      }

      // Step 2: Force Angular change detection
      this.cdr.detectChanges();

      // Step 3: Wait for DOM cleanup
      setTimeout(() => {
        // Step 4: Manually rebuild table HTML if needed
        // Step 5: Reinitialize with fresh DataTable
        setTimeout(() => {
          this.dtTrigger.next(null);

          // Step 6: If still no luck, try direct jQuery DataTable initialization
          setTimeout(() => {
            if (!$.fn.dataTable.isDataTable('#myTable') && this.tableData.length > 0) {
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
    this.newsReminder.scheduleAllReminders(this.newsData);
  }

  clearAllReminders(): void {
    this.newsReminder.clearAllReminders();
  }

  /**
   * Check if a specific news event has active reminders
   */
  isNewsReminderActive(newsEvent: any): boolean {
    return this.newsReminder.isNewsReminderActive(newsEvent);
  }

  isNewsEnded(newsEvent: any): boolean {
    const eventTime = new Date(`${newsEvent?.date} ${newsEvent?.time}`);
    return !Number.isNaN(eventTime.getTime()) && eventTime < new Date();
  }

  // Trading settings handler methods
  onProfitTargetChange(): void {

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
    // Stop any existing celebration first
    this.confetti.stopCurrentCelebration();
    // Start new celebration
    setTimeout(() => {
      this.confetti.celebrateProfitTarget(this.mt5AccountInfo.profitTarget);
    }, 100);
  }

  // Check for profit target achievement and trigger celebration
  private checkForProfitTargetCelebration(): void {
    const currentPercentageGain = this.calculateTotalPercentageGain();

    // Show celebration whenever we're at or above target
    if (currentPercentageGain >= this.mt5AccountInfo.profitTarget) {
      // Only trigger if we haven't celebrated this target yet
      if (!this.hasCelebratedCurrentTarget) {
        // Mark as celebrated to prevent multiple triggers
        this.hasCelebratedCurrentTarget = true;
        this.lastCelebratedTarget = this.mt5AccountInfo.profitTarget;

        // Trigger the amazing persistent confetti celebration!
        this.confetti.celebrateProfitTarget(this.mt5AccountInfo.profitTarget);

        this.playProfitTargetMusic();
      }
    } else {
      // If we fall below target, stop celebration and reset flag
      if (this.hasCelebratedCurrentTarget) {
        this.confetti.stopCurrentCelebration();
        this.hasCelebratedCurrentTarget = false;
      }
    }
  }

  private playProfitTargetMusic(): void {
    void this.confetti.playCelebrationMusic();
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

  private playNewsReminderSound(): void {
    this.newsReminderAudio ??= new Audio(this.newsReminderSoundUrl);
    this.newsReminderAudio.loop = true;
    this.newsReminderAudio.currentTime = 0;
    void this.newsReminderAudio.play().catch(() => undefined);
  }

  dismissNewsReminder(): void {
    this.newsReminderAudio?.pause();
    this.newsReminderNotice = null;
    this.cdr.markForCheck();
  }

  private handleNewsUiReminder(events: any[], minutesBefore: number): void {
    if (!events?.length) return;

    const titles = events.map(event => this.getNewsTitle(event));
    this.newsReminderNotice = {
      title: events.length === 1 ? titles[0] : `${events.length} news events: ${titles.join(', ')}`,
      currencies: [...new Set(events.map(event => event.currency))].join(', '),
      time: events[0].time || 'Unknown time',
      minutesBefore
    };
    this.playNewsReminderSound();
    this.cdr.markForCheck();
  }

  // Recent Trades PnL tiles helpers
  getRecentTrades(limit: number = 10): Table[] {
    const items = Array.isArray(this.tableData) ? [...this.tableData] : [];
    items.sort((a, b) => {
      const da = this.parseOpenDate(a.openDate || '')?.getTime() || 0;
      const db = this.parseOpenDate(b.openDate || '')?.getTime() || 0;
      return db - da; // newest first
    });
    return items.slice(0, limit);
  }

  getRecentTradeChunks(): Table[][] {
    const recent = this.getRecentTrades(10);
    const chunks: Table[][] = [];
    for (let i = 0; i < recent.length; i += 5) {
      chunks.push(recent.slice(i, i + 5));
    }
    return chunks;
  }

  // Session (day) filtering helpers for tiles
  private getSessionFilteredTrades(): Table[] {
    const { start, end } = this.getSessionWindowUtc();
    return (Array.isArray(this.tableData) ? this.tableData : []).filter(t => {
      const od = this.parseOpenDate(t.openDate || '');
      return !!od && od.getTime() >= start.getTime() && od.getTime() <= end.getTime();
    });
  }

  // Today-only filtering helpers for Day Trades chips (midnight PHT to now)
  private getTodayFilteredTrades(): Table[] {
    const { start, end } = this.getTodayWindowUtc();
    return (Array.isArray(this.tableData) ? this.tableData : []).filter(t => {
      const od = this.parseOpenDate(t.openDate || '');
      return !!od && od.getTime() >= start.getTime() && od.getTime() <= end.getTime();
    });
  }

  getRecentSessionTrades(limit: number = 10): Table[] {
    // Use today's trades in the exact order they appear in the table (no sorting)
    const items = this.getTodayFilteredTrades();
    return items.slice(0, limit);
  }

  getRecentSessionTradeChunks(): Table[][] {
    const recent = this.getRecentSessionTrades(10);
    const chunks: Table[][] = [];
    for (let i = 0; i < recent.length; i += 5) {
      chunks.push(recent.slice(i, i + 5));
    }
    return chunks;
  }

  getNetFromCommissionPlusGross(row: Table): number {
    const gross = this.getSafeNumber(row.profit);
    const commission = this.getSafeNumber(row.commission);
    return gross + commission;
  }

  private getNetCommissionGrossPercentage(row: Table): number {
    const base = (this.mt5AccountInfo?.startingBalance && this.mt5AccountInfo.startingBalance > 0)
      ? this.mt5AccountInfo.startingBalance
      : (this.calculateAccountSize() || 2500);
    if (base <= 0) return 0;
    const net = this.getNetFromCommissionPlusGross(row);
    return (net / base) * 100;
  }

  getSignedPercentage(row: Table): string {
    const pct = this.getNetCommissionGrossPercentage(row);
    if (!isFinite(pct) || isNaN(pct)) return '0.00%';
    const sign = pct > 0 ? '+' : pct < 0 ? '' : '';
    return `${sign}${pct.toFixed(2)}%`;
  }

  formatShortDate(dateStr: string): string {
    const d = this.parseOpenDate(dateStr || '');
    if (!d) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}`;
  }

  onMaxLossChange(): void {


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
    console.log('📊 Updating trading targets - Profit:', this.mt5AccountInfo.profitTarget + '%, Max Loss:', this.mt5AccountInfo.maxTotalDrawdown + '%');

    // Trigger chart refresh to update profit target line
    this.generateTradingChartData();

    // Save to localStorage for persistence
    localStorage.setItem('tradingProfitTarget', this.mt5AccountInfo.profitTarget.toString());
    localStorage.setItem('tradingMaxLoss', this.mt5AccountInfo.maxTotalDrawdown.toString());
  }



}
