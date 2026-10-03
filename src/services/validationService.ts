import { ensure, type AttendanceCodes, type AttendanceRecord, type Fields, type PlannedDay } from '../domain/attendance.js';
export function buildPlan(records: AttendanceRecord[], office: number[], paid: number[], codes: AttendanceCodes): PlannedDay[] {
  for (const d of office) {
    ensure(!paid.includes(d), `${d}日が出社日と有休日の両方に指定されています。`);
    ensure(records.some(r => r.day === d && r.hasWork), `${d}日はExcel上で勤務実績がありません。出社日として指定できません。`);
  }
  for (const d of paid) {
    const r = records.find(r => r.day === d);
    ensure(r && !r.hasWork, `${d}日はExcel勤務実績と有休指定が競合するか、存在しない日です。`);
  }
  return records.filter(r => r.hasWork || paid.includes(r.day)).map(record => {
    const kind = paid.includes(record.day) ? 'paid' : office.includes(record.day) ? 'office' : 'remote';
    return { record, kind, expected: { pattern: codes.workPatternCode, reason: kind === 'paid' ? codes.paidLeaveReasonCode : kind === 'office' ? codes.officeReasonCode ?? '' : codes.remoteReasonCode,
      start: record.startTime ?? '', end: record.endTime ?? '', break: record.hasWork ? record.breakHours!.toFixed(2) : '', worked: record.hasWork ? record.workedHours!.toFixed(2) : '' } };
  });
}
export function normalize(key: keyof Fields, value: string): string {
  const v = value.normalize('NFKC').trim();
  if (!v) return '';
  if (key === 'pattern' || key === 'reason') {
    ensure(/^\d+(?:\s|$)/.test(v), `${key}: コードが取得できません。`);
    return v.match(/^\d+/)![0];
  }
  if (key === 'start' || key === 'end') {
    ensure(/^\d{1,2}:\d{2}$/.test(v), `${key}: 時刻が不正です。`);
    const [h, m] = v.split(':').map(Number);
    ensure(h <= 47 && m <= 59, `${key}: 時刻が範囲外です。`);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  ensure(/^\d+(\.\d+)?$/.test(v), `${key}: 小数時間を取得できません。`);
  return Number(v).toFixed(2);
}
export function normalized(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, normalize(k as keyof Fields, v)])) as unknown as Fields;
}
export function equals(actual: Fields, expected: Fields): boolean {
  return (Object.keys(expected) as (keyof Fields)[]).every(k => actual[k] === expected[k] || ((k === 'worked' || k === 'break') && !expected[k] && actual[k] === '0.00'));
}
export function conflicts(actual: Fields, day: PlannedDay, remoteCode: string): string[] {
  return (Object.keys(actual) as (keyof Fields)[]).filter(k => {
    if (k === 'pattern' || !actual[k] || actual[k] === day.expected[k]) return false;
    if ((k === 'worked' || k === 'break') && actual[k] === '0.00' && !actual.start && !actual.end) return false;
    // Explicit requirement: remove an old remote reason on a declared office day.
    if (k === 'reason' && day.kind === 'office' && actual.reason === remoteCode) return false;
    return true;
  }).map(k => `${day.record.date} ${k}: 現在=${actual[k]} / 予定=${day.expected[k] || '(空欄)'}`);
}
