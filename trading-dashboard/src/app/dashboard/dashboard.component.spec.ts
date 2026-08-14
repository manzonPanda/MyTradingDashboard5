import { ComponentFixture, TestBed } from '@angular/core/testing';

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
});
