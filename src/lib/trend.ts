import { parseDay } from './dates';

export interface WeightPoint {
  date: string;
  kg: number;
}

export interface TrendPoint extends WeightPoint {
  trend: number;
}

const DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY_MS);
}

/**
 * Smoothed weight line: trend today = trend yesterday + 0.1 × (weight − trend yesterday).
 * If there are days without a measurement in between, the smoothing applies over the elapsed days,
 * as if the trend had stayed unchanged on the gap days.
 */
export function trendSeries(points: WeightPoint[], smoothing = 0.1): TrendPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: TrendPoint[] = [];
  let trend = 0;
  let previous: string | undefined;
  for (const point of sorted) {
    if (previous === undefined) {
      trend = point.kg;
    } else {
      const gap = Math.max(1, daysBetween(previous, point.date));
      trend += (1 - (1 - smoothing) ** gap) * (point.kg - trend);
    }
    previous = point.date;
    out.push({ ...point, trend });
  }
  return out;
}

/**
 * Change of the trend in kg per week, measured over roughly the last 14 days.
 * Returns undefined as long as fewer than seven days lie between the measurements.
 */
export function weeklyRate(series: TrendPoint[], windowDays = 14): number | undefined {
  const last = series.at(-1);
  if (!last) return undefined;
  let start: TrendPoint | undefined;
  for (const point of series) {
    if (daysBetween(point.date, last.date) <= windowDays) {
      start = point;
      break;
    }
  }
  if (!start) return undefined;
  const span = daysBetween(start.date, last.date);
  if (span < 7) return undefined;
  return ((last.trend - start.trend) / span) * 7;
}
