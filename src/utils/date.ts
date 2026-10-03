import { basename } from 'node:path';
import { ensure, type Period } from '../domain/attendance.js';
export const daysInMonth = (p: Period) => new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
export const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (p: Period, day: number) => `${p.year}-${pad(p.month)}-${pad(day)}`;
export function periodFromFilename(file: string): Period {
  const match = /^(\d{4})(\d{2})_.+/.exec(basename(file));
  ensure(match, 'ファイル名は YYYYMM_名称.xls / .xlsx 形式にしてください。');
  const p = { year: Number(match[1]), month: Number(match[2]) };
  ensure(p.year >= 1900 && p.month >= 1 && p.month <= 12, 'ファイル名の年月が不正です。');
  return p;
}
export function parseDays(text: string, p: Period): number[] {
  if (!text.trim()) return [];
  const days = text.split(/[,、]/).map(s => {
    ensure(/^\d{1,2}$/.test(s.trim()), `日付の入力が不正です: ${s}`);
    const d = Number(s.trim());
    ensure(d >= 1 && d <= daysInMonth(p), `${d}日は${p.year}年${p.month}月には存在しません。`);
    return d;
  });
  return [...new Set(days)].sort((a, b) => a - b);
}
export function parseScreenPeriod(text: string): { year?: number; month: number } {
  const normalized = text.normalize('NFKC').replace(/\s+/g, '');
  const full = /^(?:(令和|平成)(元|\d+)年|(\d{4})年)(\d{1,2})月$/.exec(normalized);
  const monthOnly = /^(\d{1,2})月$/.exec(normalized);
  ensure(full || monthOnly, '画面の年月を一意に解釈できません。年月専用要素を設定してください。');
  const year = full ? (full[3] ? Number(full[3]) : (full[1] === '令和' ? 2018 : 1988) + (full[2] === '元' ? 1 : Number(full[2]))) : undefined;
  const month = Number(full ? full[4] : monthOnly![1]);
  ensure(month >= 1 && month <= 12, '画面の月が不正です。');
  return { year, month };
}
export function isWholeMonthRange(text: string, period: Period): boolean {
  const normalized = text.normalize('NFKC').replace(/\s+/g, '');
  const dates = [...normalized.matchAll(/(?:(令和|平成)(元|\d+)年|(\d{4})年)(\d{1,2})月(\d{1,2})日/g)].map(m => ({
    year: m[3] ? Number(m[3]) : (m[1] === '令和' ? 2018 : 1988) + (m[2] === '元' ? 1 : Number(m[2])),
    month: Number(m[4]), day: Number(m[5])
  }));
  return dates.length === 2 && dates.every(d => d.year === period.year && d.month === period.month)
    && dates[0].day === 1 && dates[1].day === daysInMonth(period);
}
export function timestamp(date: Date, format: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  const values: Record<string, string> = { yyyy: get('year'), MM: get('month'), dd: get('day'), HH: get('hour'), mm: get('minute'), ss: get('second') };
  ensure(/^([yMdHms]|[-_])+$/.test(format), 'バックアップ日時形式が不正です。');
  const result = format.replace(/yyyy|MM|dd|HH|mm|ss/g, t => values[t]);
  ensure(!/[a-zA-Z]/.test(result) && result.length > 0, '未対応の日時トークンです。');
  return result;
}
