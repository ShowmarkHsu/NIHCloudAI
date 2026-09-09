import type { PhaseOneSourceFamily } from '../contracts/coverage';

export const SUMMARY_TIME_WINDOW_DAYS = Object.freeze({
  recentCourseAndTests: 90,
  admissionsProceduresAndDischarge: 365,
} as const);

export type SummaryTimeWindow =
  | 'current-available-data'
  | 'past-90-days'
  | 'past-1-year';

const SOURCE_FAMILY_TIME_WINDOWS: Readonly<
  Record<PhaseOneSourceFamily, SummaryTimeWindow>
> = Object.freeze({
  encounter: 'past-90-days',
  'western-medication': 'current-available-data',
  'chinese-medication': 'current-available-data',
  allergy: 'current-available-data',
  lab: 'past-90-days',
  imaging: 'past-90-days',
  procedure: 'past-1-year',
  discharge: 'past-1-year',
});

const DAYS_TO_MILLISECONDS = 24 * 60 * 60 * 1_000;

function parseLocalDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) throw new TypeError('date must be an ISO local date');

  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(timestamp)) throw new TypeError('date must be valid');
  return timestamp;
}

function taipeiLocalDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new TypeError('as-of timestamp must be valid');

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function summaryTimeWindowForSourceFamily(
  sourceFamily: PhaseOneSourceFamily,
): SummaryTimeWindow {
  return SOURCE_FAMILY_TIME_WINDOWS[sourceFamily];
}

export function isDateWithinSummaryTimeWindow(
  recordDate: string,
  capturedAt: string,
  timeWindow: SummaryTimeWindow,
): boolean {
  if (timeWindow === 'current-available-data') return true;

  const days =
    timeWindow === 'past-90-days'
      ? SUMMARY_TIME_WINDOW_DAYS.recentCourseAndTests
      : SUMMARY_TIME_WINDOW_DAYS.admissionsProceduresAndDischarge;
  const difference =
    (parseLocalDate(taipeiLocalDate(capturedAt)) - parseLocalDate(recordDate)) /
    DAYS_TO_MILLISECONDS;

  return Number.isInteger(difference) && difference >= 0 && difference <= days;
}
