import { Injectable } from '@angular/core';

/**
 * The5ers MT5 server timezone.
 *
 * MT5 brokers (including The5ers) run their trade server on Eastern European
 * Time and expose trade timestamps as NAIVE server wall-clock strings such as
 * "2026-07-31 19:42:21". EET/EEST follows EU daylight-saving rules:
 *
 *   - EET  (winter) = UTC+2 → Asia/Manila (UTC+8) = +6 hours
 *   - EEST (summer) = UTC+3 → Asia/Manila (UTC+8) = +5 hours
 *
 * We use the IANA timezone database (via the platform's Intl API) so the offset
 * is resolved automatically per timestamp instead of hard-coding +5/+6.
 */
export const MT5_SERVER_TIME_ZONE = 'Europe/Helsinki';
export const PHILIPPINE_TIME_ZONE = 'Asia/Manila';

const NAIVE_WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

export interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Parse a naive wall-clock timestamp string ("YYYY-MM-DD HH:MM:SS" or with a
 * "T" separator, fractional seconds tolerated) into numeric parts.
 */
export function parseNaiveTimestamp(value: string): WallClockParts | null {
  if (!value) return null;
  const match = NAIVE_WALL_RE.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0'] = match;
  const parsed = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
  if (parsed.year < 1970 || parsed.year > 2100) return null;
  return parsed;
}

/**
 * Normalize an MT5/Supabase timestamp to the canonical storage format
 * "YYYY-MM-DD HH:MM:SS" WITHOUT shifting the wall-clock value. This is what we
 * persist into trades.time_open / trades.time_close so the original MT5 server
 * timestamp is preserved byte-for-byte.
 */
export function normalizeMt5ServerTime(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parts = parseNaiveTimestamp(value);
  if (!parts) return undefined;
  return `${pad(parts.year)}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/**
 * Wall-clock parts for `instantMs` expressed in `zone`. Uses the browser's
 * built-in IANA timezone database (Intl.DateTimeFormat), so DST transitions are
 * handled automatically.
 */
export function wallClockInZone(zone: string, instantMs: number): WallClockParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(instantMs));
  const read = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? '0');
  let hour = read('hour');
  if (hour === 24) hour = 0; // a few engines emit "24:00:00" for midnight
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * UTC offset (in milliseconds) of `zone` at the given instant. Computed as
 * (wall clock in zone) − (actual UTC instant), fully DST-aware.
 */
function zoneOffsetMs(zone: string, instantMs: number): number {
  const wall = wallClockInZone(zone, instantMs);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - instantMs;
}

/** Convert a UTC timestamp to Philippine time (Asia/Manila). */
export function utcTimeToPhilippine(value: string | null | undefined): string | undefined {
  const parts = parseNaiveTimestamp(value ?? '');
  if (!parts) return undefined;

  const utcTimestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const ph = wallClockInZone(PHILIPPINE_TIME_ZONE, utcTimestamp);
  return `${pad(ph.year)}-${pad(ph.month)}-${pad(ph.day)} ${pad(ph.hour)}:${pad(ph.minute)}:${pad(ph.second)}`;
}

export function mt5ServerTimeToPhilippine(value: string | null | undefined): string | undefined {
  const parts = parseNaiveTimestamp(value ?? '');
  if (!parts) return undefined;

  const naiveAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let instant = naiveAsUtc - zoneOffsetMs(MT5_SERVER_TIME_ZONE, naiveAsUtc);

  // Fixed-point refinement: verify with the corrected instant so the offset
  // used is the one actually in force at the real UTC instant.
  const corrected = naiveAsUtc - zoneOffsetMs(MT5_SERVER_TIME_ZONE, instant);
  if (corrected !== instant) {
    instant = corrected;
  }

  const ph = wallClockInZone(PHILIPPINE_TIME_ZONE, instant);
  return `${pad(ph.year)}-${pad(ph.month)}-${pad(ph.day)} ${pad(ph.hour)}:${pad(ph.minute)}:${pad(ph.second)}`;
}

/** Convert a UTC timestamp into the naïve MT5 server wall-clock format. */
export function utcTimeToMt5ServerTime(value: string | null | undefined): string | undefined {
  const parts = parseNaiveTimestamp(value ?? '');
  if (!parts) return undefined;

  const server = wallClockInZone(
    MT5_SERVER_TIME_ZONE,
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  );
  return `${pad(server.year)}-${pad(server.month)}-${pad(server.day)} ${pad(server.hour)}:${pad(server.minute)}:${pad(server.second)}`;
}

@Injectable({
  providedIn: 'root',
})
export class Mt5TimeService {
  readonly mt5ServerTimeZone = MT5_SERVER_TIME_ZONE;
  readonly philippineTimeZone = PHILIPPINE_TIME_ZONE;

  /** Convert a UTC MT5 timestamp to Asia/Manila. */
  utcTimeToPhilippine(value: string | null | undefined): string | undefined {
    return utcTimeToPhilippine(value);
  }

  /** DST-aware MT5 server time (EET/EEST) → Asia/Manila. */
  mt5ServerTimeToPhilippine(value: string | null | undefined): string | undefined {
    return mt5ServerTimeToPhilippine(value);
  }

  /** Convert a UTC timestamp into the naïve MT5 server wall-clock format. */
  utcTimeToMt5ServerTime(value: string | null | undefined): string | undefined {
    return utcTimeToMt5ServerTime(value);
  }

  /** Keep the original MT5 wall-clock but normalize to "YYYY-MM-DD HH:MM:SS". */
  normalizeMt5ServerTime(value: string | null | undefined): string | undefined {
    return normalizeMt5ServerTime(value);
  }
}
