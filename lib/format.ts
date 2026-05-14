import Decimal from "decimal.js";

export function formatMoney(amount: Decimal | string | number): string {
  const d = amount instanceof Decimal ? amount : new Decimal(amount);
  const sign = d.isNegative() ? "-" : "";
  const abs = d.abs();
  return `${sign}$${abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function formatMoneySigned(amount: Decimal | string | number): string {
  const d = amount instanceof Decimal ? amount : new Decimal(amount);
  if (d.isPositive() && !d.isZero()) return `+${formatMoney(d)}`;
  return formatMoney(d);
}

/**
 * The clubroom's local timezone. Used for rendering all timestamps consistently
 * across server and client components — otherwise server renders fall back to
 * the Node.js runtime locale (UTC on Vercel) and client renders use the browser.
 *
 * Hard-coded to The Office (Tustin, CA). When/if a future cardroom is in a
 * different timezone, promote this to a per-club setting (Club.timezone column
 * or Postgres `time zone` row).
 */
export const CLUB_TIMEZONE = "America/Los_Angeles";

function toDate(input: string | Date): Date {
  return typeof input === "string" ? new Date(input) : input;
}

/** HH:MM AM/PM in CLUB_TIMEZONE (e.g. "01:25 AM"). */
export function formatLocalTime(input: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLUB_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(toDate(input));
}

/** Full HH:MM:SS AM/PM in CLUB_TIMEZONE (e.g. "01:25:58 AM"). */
export function formatLocalTimeWithSeconds(input: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLUB_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(toDate(input));
}

/** Date only, e.g. "May 9, 2026". */
export function formatLocalDate(input: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLUB_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(toDate(input));
}
