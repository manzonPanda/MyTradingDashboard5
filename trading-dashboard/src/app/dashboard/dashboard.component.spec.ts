import { ComponentFixture, TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';
import { TradeService } from '../services/trade.service';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('counts calendar days inclusively from account start through the latest trade', () => {
    component.selectedAccount = {
      id: 'account-1',
      name: 'Test account',
      start_date: '2025-01-01'
    };
    component.tableData = [
      { openDate: '2025.01.03 09:00' } as any,
      { openDate: '2025.01.10 09:00' } as any
    ];

    expect(component.calculateDaysSinceFirstTrade()).toBe(10);
  });

  it('returns zero when the account start date or trade dates are unavailable', () => {
    component.selectedAccount = {
      id: 'account-1',
      name: 'Test account',
      start_date: null
    };
    component.tableData = [{ openDate: '2025.01.10 09:00' } as any];

    expect(component.calculateDaysSinceFirstTrade()).toBe(0);

    component.selectedAccount.start_date = '2025-01-11';
    expect(component.calculateDaysSinceFirstTrade()).toBe(0);
  });

  it('calculates persisted R from profit and risk instead of the planned target ratio', () => {
    const trade = { profit: '150', riskPerTrade: '100', rrr: '4.00' } as any;

    expect((component as any).calculateTradeR(trade)).toBe('1.50');
  });

  it('uses the reported R when the trade has no risk amount', () => {
    const trade = { profit: '150', riskPerTrade: '0', rrr: '-0.75R' } as any;

    expect((component as any).calculateTradeR(trade)).toBe('-0.75');
  });

  it('closes verified live MT5 trades once the daily target is reached', () => {
    const tradeService = TestBed.inject(TradeService);
    const closeAllTrades = spyOn(tradeService, 'closeAllTrades').and.returnValue(of({ success: true }));
    component.dailyTarget = 2;
    component.dailyPnLPercent = 2;
    component.selectedAccount = { id: 'account-1', name: 'Test account', platform: 'MT5', account_number: '110566588' } as any;
    component.mt5LiveTrades = [{ position: '101' } as any];
    (component as any).mt5ServiceConnected = true;
    (component as any).mt5AccountLogin = '110566588';
    (component as any).isMt5LiveSnapshotAvailable = true;
    (component as any).mt5OpenPositionIds = new Set(['101']);

    (component as any).closeOpenLiveTradesAtDailyTarget();

    expect(closeAllTrades).toHaveBeenCalledTimes(1);
    expect((component as any).mt5OpenPositionIds.has('101')).toBeFalse();
  });

  it('does not immediately retry a failed daily target close', () => {
    const tradeService = TestBed.inject(TradeService);
    const closeAllTrades = spyOn(tradeService, 'closeAllTrades').and.returnValue(throwError(() => new Error('MT5 unavailable')));
    component.dailyTarget = 2;
    component.dailyPnLPercent = 2;
    component.selectedAccount = { id: 'account-1', name: 'Test account', platform: 'MT5', account_number: '110566588' } as any;
    component.mt5LiveTrades = [{ position: '101' } as any];
    (component as any).mt5ServiceConnected = true;
    (component as any).mt5AccountLogin = '110566588';
    (component as any).isMt5LiveSnapshotAvailable = true;
    (component as any).mt5OpenPositionIds = new Set(['101']);

    (component as any).closeOpenLiveTradesAtDailyTarget();
    (component as any).closeOpenLiveTradesAtDailyTarget();

    expect(closeAllTrades).toHaveBeenCalledTimes(1);
  });

  it('uses 5 AM PHT as the Day Trades session boundary', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date('2025-04-06T20:59:00Z'));
      expect((component as any).getCurrentSessionStart().toISOString()).toBe('2025-04-05T21:00:00.000Z');

      jasmine.clock().mockDate(new Date('2025-04-06T21:00:00Z'));
      expect((component as any).getCurrentSessionStart().toISOString()).toBe('2025-04-06T21:00:00.000Z');
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
