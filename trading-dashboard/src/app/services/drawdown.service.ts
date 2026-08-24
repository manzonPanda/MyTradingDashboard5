import { Injectable } from '@angular/core';

/**
 * Centralized drawdown configuration + calculation engine.
 *
 * The dashboard UI never implements drawdown math itself — it feeds account
 * configuration and trading data into this service and renders the returned
 * DrawdownState. The same state is reused by the equity chart reference lines,
 * alerts, and any future risk-management consumers.
 *
 * Only CONFIGURATION is persisted on the account row (max %, mode, basis,
 * stop-at-initial-balance toggle, EOD timezone). Calculated values such as
 * the current floor are derived here from trading data — never stored.
 */

/** Available drawdown rule types. */
export type DrawdownMode = 'fixed' | 'intraday_trailing' | 'balance_trailing' | 'eod_trailing';

/** Which side of the account value a trailing/EOD rule follows. */
export type DrawdownBasis = 'balance' | 'equity';

export interface DrawdownConfig {
  mode: DrawdownMode;
  /** Trailing basis for intraday/balance trailing; also used as the EOD basis. */
  basis: DrawdownBasis;
  /**
   * Universal trailing behavior: when enabled, the floor may trail upward but
   * stops moving once it reaches the account's initial balance (locked).
   */
  stopAtInitialBalance: boolean;
  /** IANA timezone used to group trading days for EOD trailing. */
  eodTimezone: string;
}

export const DEFAULT_DRAWDOWN_CONFIG: DrawdownConfig = {
  mode: 'fixed',
  basis: 'balance',
  stopAtInitialBalance: false,
  eodTimezone: 'America/New_York',
};

/** Minimal equity-curve point the engine needs (subset of AccountEquityPoint). */
export interface DrawdownCurvePoint {
  timestamp: string;
  balance: number;
  equity: number;
}

/** Trading-data inputs required to calculate the current drawdown state. */
export interface DrawdownInput {
  startingBalance: number;
  maxDrawdownPercent: number;
  /** Realized equity curve ordered chronologically (must include the start point). */
  points: DrawdownCurvePoint[];
  currentBalance: number;
  currentEquity: number;
  /**
   * ISO timestamp marking the start of the current trading session/window.
   * Used by intraday trailing to only consider peaks inside today's session.
   */
  sessionStartTimestamp?: string | null;
}

export type DrawdownStatus = 'normal' | 'approaching' | 'locked' | 'breached';

/** Everything the Max Drawdown card (and other consumers) need to render. */
export interface DrawdownState {
  mode: DrawdownMode;
  modeLabel: string;
  tooltip: string;
  /** Current drawdown floor in currency terms (null when it cannot be computed). */
  floor: number | null;
  startingBalance: number;
  maxDrawdownAmount: number;
  /** Percentage of the allowed drawdown buffer already consumed (0-100). */
  bufferUsedPercent: number;
  /** True when stop-at-initial-balance engaged and the floor is parked at IB. */
  locked: boolean;
  breached: boolean;
  approaching: boolean;
  status: DrawdownStatus;
}

export interface DrawdownModeMeta {
  value: DrawdownMode;
  label: string;
  shortLabel: string;
  tooltip: string;
}

/** Display metadata for each supported drawdown mode. */
export const DRAWDOWN_MODES: DrawdownModeMeta[] = [
  {
    value: 'fixed',
    label: 'Fixed',
    shortLabel: 'Fixed',
    tooltip: 'Static drawdown level based on your starting balance. It never moves.',
  },
  {
    value: 'intraday_trailing',
    label: 'Intraday Trailing',
    shortLabel: 'Intraday Trailing',
    tooltip:
      'Drawdown floor trails the highest point reached during the current trading day and resets with each new session.',
  },
  {
    value: 'balance_trailing',
    label: 'Balance Trailing',
    shortLabel: 'Balance Trailing',
    tooltip: 'Drawdown floor follows your highest realized account balance.',
  },
  {
    value: 'eod_trailing',
    label: 'EOD Trailing',
    shortLabel: 'EOD Trailing',
    tooltip: "Drawdown floor is recalculated using the account's end-of-day result.",
  },
];

/** Portion of the drawdown buffer that triggers the amber "approaching" accent. */
const APPROACHING_BUFFER_RATIO = 0.35;

const round2 = (value: number): number => Math.round(value * 100) / 100;

@Injectable({ providedIn: 'root' })
export class DrawdownService {
  /** Mode metadata lookup (label shown on the card + hover tooltip). */
  getModeMeta(mode: DrawdownMode | null | undefined): DrawdownModeMeta {
    return DRAWDOWN_MODES.find((meta) => meta.value === mode) ?? DRAWDOWN_MODES[0];
  }

  /** All available modes for configuration dropdowns. */
  getAvailableModes(): DrawdownModeMeta[] {
    return [...DRAWDOWN_MODES];
  }

  /** Dollar amount of the configured maximum drawdown. */
  getMaxDrawdownAmount(startingBalance: number, maxDrawdownPercent: number): number {
    if (!Number.isFinite(startingBalance) || !Number.isFinite(maxDrawdownPercent)) return 0;
    return round2(Math.max(0, startingBalance) * (Math.max(0, maxDrawdownPercent) / 100));
  }

  /**
   * Pure drawdown-state calculation. Safe to call with partial data — every
   * input is guarded and the result degrades to a fixed-style floor.
   */
  computeState(config: DrawdownConfig, input: DrawdownInput): DrawdownState {
    const meta = this.getModeMeta(config?.mode);
    const startingBalance = Math.max(0, Number(input?.startingBalance) || 0);
    const amount = this.getMaxDrawdownAmount(startingBalance, Number(input?.maxDrawdownPercent) || 0);
    const currentEquity = Number.isFinite(input?.currentEquity)
      ? Number(input.currentEquity)
      : startingBalance;

    const rawFloor = this.computeRawFloor(config, input, startingBalance, amount);
    const capped = this.applyStopAtInitialBalance(config, rawFloor, startingBalance);

    const floor = capped.floor;
    const remainingBuffer = floor === null ? amount : Math.max(0, currentEquity - floor);
    const bufferUsedPercent =
      amount > 0 ? Math.min(100, Math.max(0, ((amount - remainingBuffer) / amount) * 100)) : 0;

    const breached = floor !== null && startingBalance > 0 && currentEquity <= floor;
    const approaching =
      !breached &&
      amount > 0 &&
      remainingBuffer <= amount * APPROACHING_BUFFER_RATIO &&
      bufferUsedPercent > 50;
    const status: DrawdownStatus = breached
      ? 'breached'
      : approaching
        ? 'approaching'
        : capped.locked
          ? 'locked'
          : 'normal';

    return {
      mode: meta.value,
      modeLabel: meta.shortLabel,
      tooltip: meta.tooltip,
      floor,
      startingBalance,
      maxDrawdownAmount: amount,
      bufferUsedPercent: round2(bufferUsedPercent),
      locked: capped.locked && !breached,
      breached,
      approaching,
      status,
    };
  }


  /** Floor before the stop-at-initial-balance cap, per selected mode. */
  private computeRawFloor(
    config: DrawdownConfig,
    input: DrawdownInput,
    startingBalance: number,
    amount: number
  ): number | null {
    if (startingBalance <= 0) return null;
    const staticFloor = startingBalance - amount;
    const points = Array.isArray(input?.points) ? input.points : [];
    if (points.length === 0 || amount <= 0) return staticFloor;

    switch (config.mode) {
      case 'balance_trailing':
        return this.floorFromPeak(points, config.basis, amount, staticFloor);
      case 'intraday_trailing':
        return this.intradayFloor(config, input, points, amount, staticFloor);
      case 'eod_trailing':
        return this.eodFloor(config, points, amount, staticFloor);
      case 'fixed':
      default:
        return staticFloor;
    }
  }

  /** Peak-of-basis trailing: floor follows the highest realized value seen so far. */
  private floorFromPeak(
    points: DrawdownCurvePoint[],
    basis: DrawdownBasis,
    amount: number,
    staticFloor: number
  ): number {
    let peak = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      const value = basis === 'equity' ? point.equity : point.balance;
      if (Number.isFinite(value) && value > peak) peak = value;
    }
    if (!Number.isFinite(peak)) return staticFloor;
    // The floor can trail up but never below the original static level.
    return Math.max(staticFloor, round2(peak - amount));
  }

  /** Intraday trailing only considers movement inside the current session window. */
  private intradayFloor(
    config: DrawdownConfig,
    input: DrawdownInput,
    points: DrawdownCurvePoint[],
    amount: number,
    staticFloor: number
  ): number {
    const sessionStart = input?.sessionStartTimestamp
      ? Date.parse(input.sessionStartTimestamp)
      : NaN;
    const hasWindow = Number.isFinite(sessionStart);

    let peak = Number.NEGATIVE_INFINITY;
    let foundInSession = false;
    for (const point of points) {
      const ts = Date.parse(point.timestamp);
      // The synthetic 'Start' point has no parseable timestamp — it always counts.
      if (hasWindow && Number.isFinite(ts) && ts < sessionStart) continue;
      const value = config.basis === 'equity' ? point.equity : point.balance;
      if (!Number.isFinite(value)) continue;
      foundInSession = true;
      if (value > peak) peak = value;
    }

    // Nothing traded yet in this session: the last realized level anchors the floor.
    if (!foundInSession || !Number.isFinite(peak)) return staticFloor;
    return Math.max(staticFloor, round2(peak - amount));
  }

  /**
   * EOD trailing groups realized points into trading days using the configured
   * timezone and takes the highest end-of-day result seen so far.
   */
  private eodFloor(
    config: DrawdownConfig,
    points: DrawdownCurvePoint[],
    amount: number,
    staticFloor: number
  ): number {
    const eodByDay = new Map<string, { balance: number; equity: number }>();
    const dayKey = this.createZonedDayKeyFn(config.eodTimezone);

    for (const point of points) {
      if (!point.timestamp || point.timestamp === 'Start') continue;
      const ts = Date.parse(point.timestamp);
      if (!Number.isFinite(ts)) continue;
      const key = dayKey(new Date(ts));
      const previous = eodByDay.get(key);
      // Later chronological points win → end-of-day result per day.
      eodByDay.set(key, {
        balance: Number.isFinite(point.balance) ? point.balance : previous?.balance ?? NaN,
        equity: Number.isFinite(point.equity) ? point.equity : previous?.equity ?? NaN,
      });
    }

    if (eodByDay.size === 0) return staticFloor;

    let bestEod = Number.NEGATIVE_INFINITY;
    for (const entry of eodByDay.values()) {
      const value = config.basis === 'equity' ? entry.equity : entry.balance;
      if (Number.isFinite(value) && value > bestEod) bestEod = value;
    }
    if (!Number.isFinite(bestEod)) return staticFloor;
    return Math.max(staticFloor, round2(bestEod - amount));
  }

  /** Builds a YYYY-MM-DD key function for a given IANA timezone. */
  private createZonedDayKeyFn(timezone: string): (date: Date) => string {
    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone && timezone.trim() ? timezone.trim() : 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      // Unknown timezone identifier — fall back to UTC grouping.
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }
    return (date: Date) => formatter.format(date); // en-CA yields YYYY-MM-DD
  }

  /**
   * Universal trailing behavior: once the floor reaches the account's initial
   * balance it must stop moving and remain fixed there ("locked").
   */
  private applyStopAtInitialBalance(
    config: DrawdownConfig,
    rawFloor: number | null,
    startingBalance: number
  ): { floor: number | null; locked: boolean } {
    if (rawFloor === null) return { floor: null, locked: false };
    if (config.mode === 'fixed' || !config.stopAtInitialBalance || startingBalance <= 0) {
      return { floor: rawFloor, locked: false };
    }

    const capped = Math.min(rawFloor, startingBalance);
    return { floor: round2(capped), locked: rawFloor >= startingBalance };
  }
}

