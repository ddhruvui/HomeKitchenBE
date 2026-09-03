/** All dates are YYYY-MM-DD strings, never timestamps (§12 J). */
export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad date: ${s}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
export function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }
export function addDays(s: string, n: number): string { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return toDateStr(d); }
export function isValidDate(s: string): boolean { try { return toDateStr(parseDate(s)) === s; } catch { return false; } }
/** The first day of the week containing `s`, for a week that starts on `weekStartsOn` (0 = Sun … 6 = Sat). */
export function weekStartFor(s: string, weekStartsOn: number): string {
  const d = parseDate(s);
  const diff = (d.getUTCDay() - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}
export function daysBetween(from: string, to: string): number { return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86400000); }

export type ExpiryStatus = 'expired' | 'soon' | 'later';
/** How an expiry date reads against today: already past, within `soonDays`, or comfortably ahead. */
export function expiryStatus(expiresOn: string, today: string, soonDays = 30): { status: ExpiryStatus; days: number } {
  const days = daysBetween(today, expiresOn);
  return { status: days < 0 ? 'expired' : days <= soonDays ? 'soon' : 'later', days };
}
export function daysInRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
