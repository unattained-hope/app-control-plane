import type { Priority } from "@prisma/client";
import { getConfig } from "~/lib/config.js";

/**
 * Support-desk SLA policy (cp-inbox-sla).
 *
 * Two pure concerns, no I/O:
 *  1. Priority → first-response / resolution budgets (in BUSINESS minutes).
 *  2. An office-hours-aware due-time calculator: budget minutes accrue ONLY during
 *     the configured daily business window on business days (Mon–Fri), so "8
 *     calendar hrs = 1 business day".
 *
 * "No priority ⇒ no SLA": a `NONE` priority yields null budgets and null due-times,
 * and such conversations are never swept.
 *
 * The clock is a single fixed-offset business window (no DST, no holiday calendar
 * in MVP — see design Open Questions); the offset/open/close come from `config`.
 */

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/** Per-priority budgets in business minutes. `NONE` is excluded (no SLA). */
export interface SlaBudget {
  readonly firstResponseMinutes: number;
  readonly resolutionMinutes: number;
}

export const SLA_BUDGETS: Readonly<Record<Exclude<Priority, "NONE">, SlaBudget>> = {
  URGENT: { firstResponseMinutes: 60, resolutionMinutes: 240 },
  HIGH: { firstResponseMinutes: 240, resolutionMinutes: 480 },
  NORMAL: { firstResponseMinutes: 480, resolutionMinutes: 1_440 },
  LOW: { firstResponseMinutes: 1_440, resolutionMinutes: 2_880 },
};

export function budgetFor(priority: Priority): SlaBudget | null {
  if (priority === "NONE") return null;
  return SLA_BUDGETS[priority];
}

interface OfficeHours {
  readonly offsetMinutes: number;
  readonly openHour: number;
  readonly closeHour: number;
}

function officeHours(): OfficeHours {
  const cfg = getConfig();
  return {
    offsetMinutes: cfg.BUSINESS_TZ_OFFSET_MINUTES,
    openHour: cfg.BUSINESS_OPEN_HOUR,
    closeHour: cfg.BUSINESS_CLOSE_HOUR,
  };
}

/** Minutes since local midnight for a UTC instant, in the business timezone. */
function localMinuteOfDay(localMs: number): number {
  const d = new Date(localMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

/** Local day-of-week (0=Sun … 6=Sat) for a shifted (local) timestamp. */
function localDayOfWeek(localMs: number): number {
  return new Date(localMs).getUTCDay();
}

/** Whether a local day-of-week is a business day (Mon–Fri). */
function isBusinessDay(dow: number): boolean {
  return dow >= 1 && dow <= 5;
}

/** Local-midnight (00:00) timestamp for the local day containing `localMs`. */
function localMidnight(localMs: number): number {
  return localMs - localMinuteOfDay(localMs) * MINUTE_MS;
}

/**
 * Add `budgetMinutes` of BUSINESS time to `start`, returning the due `Date`.
 * Walks day-by-day, consuming each day's open window until the budget is spent.
 * Returns `start` unchanged for a non-positive budget.
 */
export function addBusinessMinutes(
  start: Date,
  budgetMinutes: number,
  hours: OfficeHours = officeHours(),
): Date {
  if (budgetMinutes <= 0) return start;
  const { offsetMinutes, openHour, closeHour } = hours;
  const openMin = openHour * 60;
  const closeMin = closeHour * 60;
  const windowMinutes = Math.max(0, closeMin - openMin);
  // Degenerate window (open >= close): no business time ever elapses; fall back to
  // a plain calendar add so a due-time still exists rather than looping forever.
  if (windowMinutes === 0) return new Date(start.getTime() + budgetMinutes * MINUTE_MS);

  let localMs = start.getTime() + offsetMinutes * MINUTE_MS;
  let remaining = budgetMinutes;

  // Cap iterations as a safety backstop (years of days) against any clock anomaly.
  for (let guard = 0; guard < 4_000; guard += 1) {
    const dow = localDayOfWeek(localMs);
    const midnight = localMidnight(localMs);
    if (!isBusinessDay(dow)) {
      localMs = midnight + DAY_MINUTES * MINUTE_MS; // jump to next local midnight
      continue;
    }
    const minuteOfDay = localMinuteOfDay(localMs);
    if (minuteOfDay < openMin) {
      localMs = midnight + openMin * MINUTE_MS; // before open → move to open
      continue;
    }
    if (minuteOfDay >= closeMin) {
      localMs = midnight + DAY_MINUTES * MINUTE_MS; // after close → next day
      continue;
    }
    const availableToday = closeMin - minuteOfDay;
    if (remaining <= availableToday) {
      const dueLocalMs = localMs + remaining * MINUTE_MS;
      return new Date(dueLocalMs - offsetMinutes * MINUTE_MS); // shift back to UTC
    }
    remaining -= availableToday;
    localMs = midnight + DAY_MINUTES * MINUTE_MS; // exhaust day → next day open
  }
  // Backstop: budget impossibly large — return the last computed instant.
  return new Date(localMs - offsetMinutes * MINUTE_MS);
}

/** Computed due-times for a priority, or null when the priority carries no SLA. */
export interface SlaDueTimes {
  readonly firstResponseDueAt: Date;
  readonly resolutionDueAt: Date;
}

/**
 * Compute first-response + resolution due-times from a start instant and priority.
 * Returns null for `NONE` (no SLA).
 */
export function computeDueTimes(
  priority: Priority,
  start: Date,
  hours: OfficeHours = officeHours(),
): SlaDueTimes | null {
  const budget = budgetFor(priority);
  if (!budget) return null;
  return {
    firstResponseDueAt: addBusinessMinutes(start, budget.firstResponseMinutes, hours),
    resolutionDueAt: addBusinessMinutes(start, budget.resolutionMinutes, hours),
  };
}

/** The breach-warning window (minutes before due to flag BREACHING). */
export function breachWarningMinutes(): number {
  return getConfig().SLA_BREACH_WARNING_MINUTES;
}
