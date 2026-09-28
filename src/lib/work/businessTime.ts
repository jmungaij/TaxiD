/**
 * BUSINESS TIME — the one place TaxiD converts wall-clock time into
 * working time.
 *
 * Why this exists: response clocks and commitment deadlines were previously
 * measured in raw elapsed minutes. An enquiry that arrived at 17:40 on Friday
 * was therefore reported as "breached by 900 minutes" first thing on Monday,
 * even though nobody had been at work in between. That made "overdue",
 * "breached" and "customers waiting" disagree with each other and with reality.
 *
 * This module is PURE and configurable. Nothing here is hard-coded to a date;
 * the only fixed assumptions are the published TaxiD operating hours below,
 * which callers may override.
 */

/** Minutes past local midnight. */
export interface BusinessWindow {
  startMinute: number;
  endMinute: number;
}

export interface BusinessCalendar {
  /** IANA zone the business day is measured in. */
  timeZone: string;
  /** Windows per weekday, 0 = Sunday … 6 = Saturday. Empty = non-working day. */
  week: BusinessWindow[][];
  /** Non-working dates (ISO yyyy-mm-dd), e.g. public holidays. */
  holidays: string[];
}

const hm = (h: number, m = 0) => h * 60 + m;

/**
 * TaxiD commercial desk hours (East Africa Time).
 * Mon–Fri 08:00–18:00, Sat 09:00–13:00, Sunday closed.
 */
export const NAIROBI_BUSINESS_CALENDAR: BusinessCalendar = {
  timeZone: "Africa/Nairobi",
  week: [
    [], // Sunday
    [{ startMinute: hm(8), endMinute: hm(18) }],
    [{ startMinute: hm(8), endMinute: hm(18) }],
    [{ startMinute: hm(8), endMinute: hm(18) }],
    [{ startMinute: hm(8), endMinute: hm(18) }],
    [{ startMinute: hm(8), endMinute: hm(18) }],
    [{ startMinute: hm(9), endMinute: hm(13) }], // Saturday
  ],
  holidays: [],
};

/* ------------------------------------------------------------- zone helpers */

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatter.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      weekday: "short",
    });
    partsFormatter.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface LocalPoint {
  /** ISO yyyy-mm-dd in the calendar's zone. */
  date: string;
  /** Minutes past local midnight. */
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
}

/** Reads a UTC instant as a local calendar point in the business time zone. */
export function localPoint(at: Date, calendar: BusinessCalendar): LocalPoint {
  const parts = formatterFor(calendar.timeZone).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  return { date, minute, weekday: WEEKDAY_INDEX[get("weekday")] ?? 0 };
}

function windowsFor(point: LocalPoint, calendar: BusinessCalendar): BusinessWindow[] {
  if (calendar.holidays.includes(point.date)) return [];
  return calendar.week[point.weekday] ?? [];
}

const addDays = (at: Date, days: number) => new Date(at.getTime() + days * 86_400_000);

/** True when the instant falls inside a published working window. */
export function isWithinBusinessHours(at: Date, calendar = NAIROBI_BUSINESS_CALENDAR): boolean {
  const point = localPoint(at, calendar);
  return windowsFor(point, calendar).some(
    (w) => point.minute >= w.startMinute && point.minute < w.endMinute,
  );
}

/**
 * Working minutes between two instants. Time outside the published windows —
 * evenings, weekends, holidays — does not count against anybody.
 */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  calendar = NAIROBI_BUSINESS_CALENDAR,
): number {
  if (to.getTime() <= from.getTime()) return 0;
  let total = 0;
  // Walk local calendar days from `from` to `to`; a day is at most a handful of
  // windows, so this is cheap for any realistic SLA horizon.
  for (let cursor = from, guard = 0; guard < 800; guard += 1) {
    const point = localPoint(cursor, calendar);
    const dayStartMinute = point.minute;
    for (const w of windowsFor(point, calendar)) {
      // Convert the window into offsets relative to the cursor instant.
      const openOffset = (w.startMinute - dayStartMinute) * 60_000;
      const closeOffset = (w.endMinute - dayStartMinute) * 60_000;
      const open = Math.max(cursor.getTime() + openOffset, from.getTime());
      const close = Math.min(cursor.getTime() + closeOffset, to.getTime());
      if (close > open) total += Math.round((close - open) / 60_000);
    }
    // Move to the next local midnight.
    const next = addDays(cursor, 1);
    const nextMidnight = new Date(next.getTime() - point.minute * 60_000);
    cursor = nextMidnight.getTime() > cursor.getTime() ? nextMidnight : next;
    if (cursor.getTime() >= to.getTime()) break;
  }
  return total;
}

/**
 * The real instant reached after consuming `minutes` of working time from
 * `from`. Used to turn an SLA promise ("respond within 120 working minutes")
 * into a date a person can actually read.
 */
export function addBusinessMinutes(
  from: Date,
  minutes: number,
  calendar = NAIROBI_BUSINESS_CALENDAR,
): Date {
  if (minutes <= 0) return from;
  let remaining = minutes;
  let cursor = from;
  for (let guard = 0; guard < 800; guard += 1) {
    const point = localPoint(cursor, calendar);
    for (const w of windowsFor(point, calendar)) {
      const open = cursor.getTime() + (w.startMinute - point.minute) * 60_000;
      const close = cursor.getTime() + (w.endMinute - point.minute) * 60_000;
      const start = Math.max(open, cursor.getTime());
      if (close <= start) continue;
      const available = Math.round((close - start) / 60_000);
      if (available >= remaining) return new Date(start + remaining * 60_000);
      remaining -= available;
    }
    const next = addDays(cursor, 1);
    const nextMidnight = new Date(next.getTime() - point.minute * 60_000);
    cursor = nextMidnight.getTime() > cursor.getTime() ? nextMidnight : next;
  }
  // Unreachable for realistic inputs; return the cursor rather than inventing.
  return cursor;
}

/** Working minutes remaining before a recorded deadline (negative = late). */
export function businessMinutesUntil(
  due: Date,
  now: Date,
  calendar = NAIROBI_BUSINESS_CALENDAR,
): number {
  return due.getTime() >= now.getTime()
    ? businessMinutesBetween(now, due, calendar)
    : -businessMinutesBetween(due, now, calendar);
}
