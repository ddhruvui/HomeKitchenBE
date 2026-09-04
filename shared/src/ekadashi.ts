import { addDays } from './dates';

/** How far the lunch carry-over will look back. A fast never runs more than a day or two. */
export const MAX_CARRY_LOOKBACK = 7;

/**
 * Whose `dinner[]` is eaten at lunch on `date`: its own on a fast day (§4, the one dish covers both
 * meals), otherwise the last ordinary day's — the fast finishes its own pot, so the dinner cooked
 * before it carries past. The walk skips fast days only: an unplanned evening still means no lunch.
 */
export function lunchSourceDate(date: string, isEkadashi: (d: string) => boolean): string | null {
  if (isEkadashi(date)) return date;
  for (let i = 1; i <= MAX_CARRY_LOOKBACK; i += 1) { const d = addDays(date, -i); if (!isEkadashi(d)) return d; }
  return null;
}

/** The evening `date`'s `dinner[]` is actually cooked: the night before on a fast day, otherwise `date`. */
export function cookedOn(date: string, isEkadashi: (d: string) => boolean): string { return isEkadashi(date) ? addDays(date, -1) : date; }

/** The fast day whose dish must also be cooked on the evening of `date`, or null. */
export function cookAheadDate(date: string, isEkadashi: (d: string) => boolean): string | null { const next = addDays(date, 1); return isEkadashi(next) ? next : null; }
