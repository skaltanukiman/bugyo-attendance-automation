import * as XLSX from 'xlsx';
import type { AttendanceRecord } from '../src/domain/attendance.js';
export const codes = { workPatternCode: '205', remoteReasonCode: '007', officeReasonCode: null, paidLeaveReasonCode: '040' };
export const period = { year: 2026, month: 9 };
export const record = (day: number, work = true): AttendanceRecord => ({ date: `2026-09-${String(day).padStart(2, '0')}`, day, hasWork: work, ...(work ? { startTime: '09:00', endTime: '17:30', breakHours: 1, workedHours: 7.5 } : {}) });
export function workbook(month = 9, year = 2026) {
  const sheet: XLSX.WorkSheet = {};
  const put = (a: string, v: string | number) => sheet[a] = { t: typeof v === 'number' ? 'n' : 's', v };
  Object.entries({ B8: '日', C8: '曜', D8: '作業', E8: '開始', F8: '作業', G8: '終了 ', H8: '総', I8: '時間', J8: '休', K8: '憩', L8: '実動', M8: '時間' }).forEach(([a, v]) => put(a, v));
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= count; d++) {
    put(`B${d + 9}`, d); put(`C${d + 9}`, (Date.UTC(year, month - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  }
  Object.entries({ D10: 9, E10: 0, F10: 17, G10: 30, H10: 8, I10: 30, J10: 1, K10: 0, L10: 7, M10: 30, L42: 7, M42: 30 }).forEach(([a, v]) => put(a, v));
  sheet['!ref'] = 'B8:M42';
  return { SheetNames: ['明細'], Sheets: { 明細: sheet } } as XLSX.WorkBook;
}
