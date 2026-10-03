import { basename } from 'node:path';
import type { AttendanceCodes, Period, PlannedDay } from '../domain/attendance.js';
export function summary(file: string, period: Period, plan: PlannedDay[], codes: AttendanceCodes): string {
  const work = plan.filter(d => d.record.hasWork);
  const days = (kind: PlannedDay['kind']) => plan.filter(d => d.kind === kind).map(d => `${period.month}/${d.record.day}`).join(', ') || '未指定';
  return `\n奉行クラウド 勤務実績入力自動化\n入力ファイル: ${basename(file)}\n対象年月: ${period.year}年${period.month}月\n勤務体系: ${codes.workPatternCode}\n通常勤務: ${work.length}日\n在宅勤務: ${plan.filter(d => d.kind === 'remote').length}日\n出社日: ${days('office')}\n有休日: ${days('paid')}\n総労働時間: ${work.reduce((n, d) => n + d.record.workedHours!, 0).toFixed(2)}\n休憩時間: ${work.reduce((n, d) => n + d.record.breakHours!, 0).toFixed(2)}\n`;
}
export const leaveWarning = (code: string) => `\n========================================\n【重要：手動入力が必要です】\n有休は自動入力していません。\n必要な有休日は奉行クラウド上で「${code} 有休」を別途手動入力してください。\n有休入力後に内容を確認してから手動で「申請」を行ってください。\n========================================`;
