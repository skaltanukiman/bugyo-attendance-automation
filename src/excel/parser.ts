import * as XLSX from 'xlsx';
import { ensure, type AttendanceRecord, type Period } from '../domain/attendance.js';
import { daysInMonth, isoDate, pad } from '../utils/date.js';

// Layout verified against both supplied .xls files. Fail closed on a changed template.
const headers: Record<string, string> = { B8: '日', C8: '曜', D8: '作業', E8: '開始', F8: '作業', G8: '終了', H8: '総', I8: '時間', J8: '休', K8: '憩', L8: '実動', M8: '時間' };
export function parseWorkbook(book: XLSX.WorkBook, period: Period): AttendanceRecord[] {
  const candidates = book.SheetNames.filter(name => Object.entries(headers).every(([cell, value]) => String(book.Sheets[name][cell]?.v ?? '').trim() === value));
  ensure(candidates.length === 1, '対応する明細シートを一意に特定できません。テンプレートを確認してください。');
  const sheet = book.Sheets[candidates[0]];
  const value = (address: string): unknown => {
    const cell = sheet[address];
    ensure(cell?.t !== 'e', `${address}: Excel数式エラーです。`);
    ensure(!cell?.f || cell.v !== undefined, `${address}: 数式の計算済み値がありません。Excelで再計算して保存してください。`);
    return cell?.v;
  };
  const blank = (v: unknown) => v === undefined || v === null || v === '';
  function pair(hour: string, minute: string, maxHour: number) {
    const h = value(hour), m = value(minute);
    ensure(typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= maxHour && typeof m === 'number' && Number.isInteger(m) && m >= 0 && m < 60, `${hour}/${minute}: 時・分が不正または片方が未入力です。`);
    return h * 60 + m;
  }
  const records: AttendanceRecord[] = [];
  for (let row = 10; row <= 40; row++) {
    const day = row - 9;
    if (day > daysInMonth(period)) {
      ensure(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'].every(c => blank(value(`${c}${row}`))), `${row}行: 対象月の範囲外にデータがあります。`);
      continue;
    }
    ensure(value(`B${row}`) === day, `${row}行: 日付番号が不正です。`);
    const serial = value(`C${row}`);
    ensure(typeof serial === 'number', `${row}行: Excel日付がありません。`);
    const date = XLSX.SSF.parse_date_code(serial, { date1904: Boolean(book.Workbook?.WBProps?.date1904) });
    ensure(date && date.y === period.year && date.m === period.month && date.d === day, `${row}行: ファイル名とExcel内の日付が一致しません。`);
    const fields = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'].map(c => value(`${c}${row}`));
    const hasWork = !fields.every(blank);
    const record: AttendanceRecord = { day, date: isoDate(period, day), hasWork };
    if (hasWork) {
      const start = pair(`D${row}`, `E${row}`, 23), end = pair(`F${row}`, `G${row}`, 47);
      const gross = pair(`H${row}`, `I${row}`, 47), rest = pair(`J${row}`, `K${row}`, 47), worked = pair(`L${row}`, `M${row}`, 47);
      ensure(end > start && end - start === gross && gross - rest === worked && worked > 0, `${row}行: 出退勤・総時間・休憩・実働が一致しません。日跨ぎは終了を24時以上で記入してください。`);
      const time = (n: number) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
      Object.assign(record, { startTime: time(start), endTime: time(end), breakHours: rest / 60, workedHours: worked / 60 });
    }
    records.push(record);
  }
  const total = pair('L42', 'M42', 1000);
  ensure(Math.abs(records.reduce((n, r) => n + (r.workedHours ?? 0) * 60, 0) - total) < 0.001, 'Excelの合計実働と明細が一致しません。再計算して保存してください。');
  return records;
}
