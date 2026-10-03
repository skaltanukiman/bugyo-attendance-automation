import type { AttendancePort } from '../browser/attendancePage.js';
import { ensure, type Period, type Fields } from '../domain/attendance.js';
import { daysInMonth, isoDate } from '../utils/date.js';

// Only read methods are available in this workflow. Never call input or save.
export async function inspectScreen(port: Pick<AttendancePort, 'assertPeriod' | 'read'>, period: Period, sampleDay: number): Promise<{ days: number; sample: Fields }> {
  ensure(Number.isInteger(sampleDay) && sampleDay >= 1 && sampleDay <= daysInMonth(period), '確認日の指定が不正です。');
  await port.assertPeriod(period, async () => false);
  let sample: Fields | undefined;
  const empty = { pattern: '', reason: '', start: '', end: '', break: '', worked: '' };
  for (let day = 1; day <= daysInMonth(period); day++) {
    const actual = await port.read({ record: { date: isoDate(period, day), day, hasWork: false }, kind: 'remote', expected: empty });
    if (day === sampleDay) sample = actual;
  }
  ensure(sample, '確認日の値を読み取れません。');
  return { days: daysInMonth(period), sample };
}
