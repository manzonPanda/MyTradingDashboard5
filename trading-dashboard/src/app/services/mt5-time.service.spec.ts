import { TestBed } from '@angular/core/testing';

import { Mt5TimeService, mt5ServerTimeToPhilippine, normalizeMt5ServerTime, utcTimeToPhilippine } from './mt5-time.service';

describe('Mt5TimeService', () => {
  let service: Mt5TimeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Mt5TimeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('mt5ServerTimeToPhilippine', () => {
    it('converts an EEST (summer) server timestamp to Philippine time (+5h)', () => {
      // 2026-07-31 19:42:21 EEST (UTC+3) → 2026-08-01 00:42:21 PHT (UTC+8)
      expect(mt5ServerTimeToPhilippine('2026-07-31 19:42:21')).toBe('2026-08-01 00:42:21');
    });

    it('converts an EET (winter) server timestamp to Philippine time (+6h)', () => {
      // 2026-01-15 19:42:21 EET (UTC+2) → 2026-01-16 01:42:21 PHT (UTC+8)
      expect(mt5ServerTimeToPhilippine('2026-01-15 19:42:21')).toBe('2026-01-16 01:42:21');
    });

    it('handles dates before and after the spring DST transition', () => {
      // EU DST starts on the last Sunday of March (2026-03-29): 03:00 EET → 04:00 EEST
      expect(mt5ServerTimeToPhilippine('2026-03-28 23:00:00')).toBe('2026-03-29 05:00:00'); // still EET → +6
      expect(mt5ServerTimeToPhilippine('2026-03-29 23:00:00')).toBe('2026-03-30 04:00:00'); // already EEST → +5
    });

    it('handles dates before and after the autumn DST transition', () => {
      // EU DST ends on the last Sunday of October (2026-10-25): 04:00 EEST → 03:00 EET
      expect(mt5ServerTimeToPhilippine('2026-10-24 23:00:00')).toBe('2026-10-25 04:00:00'); // still EEST → +5
      expect(mt5ServerTimeToPhilippine('2026-10-25 23:00:00')).toBe('2026-10-26 05:00:00'); // already EET → +6
    });

    it('accepts T-separated timestamps and timestamps with seconds', () => {
      expect(mt5ServerTimeToPhilippine('2026-07-31T19:42:21')).toBe('2026-08-01 00:42:21');
      expect(mt5ServerTimeToPhilippine('2026-07-31 19:42:21.123')).toBe('2026-08-01 00:42:21');
    });

    it('returns undefined for empty/null/invalid input', () => {
      expect(mt5ServerTimeToPhilippine(undefined)).toBeUndefined();
      expect(mt5ServerTimeToPhilippine(null)).toBeUndefined();
      expect(mt5ServerTimeToPhilippine('')).toBeUndefined();
      expect(mt5ServerTimeToPhilippine('not-a-date')).toBeUndefined();
    });
  });

  it('converts the UTC timestamp emitted by the MT5 backend to Philippine time', () => {
    expect(utcTimeToPhilippine('2026-07-31 19:42:21')).toBe('2026-08-01 03:42:21');
  });

  describe('normalizeMt5ServerTime', () => {
    it('normalizes to YYYY-MM-DD HH:MM:SS without shifting the wall clock', () => {
      expect(normalizeMt5ServerTime('2026-07-31 19:42:21')).toBe('2026-07-31 19:42:21');
      expect(normalizeMt5ServerTime('2026-07-31T19:42:21')).toBe('2026-07-31 19:42:21');
      expect(normalizeMt5ServerTime('2026-07-31T19:42:21.123Z')).toBe('2026-07-31 19:42:21');
      expect(normalizeMt5ServerTime(undefined)).toBeUndefined();
      expect(normalizeMt5ServerTime('garbage')).toBeUndefined();
    });
  });
});
