export interface Period { year: number; month: number }
export interface AttendanceRecord {
  date: string; day: number; hasWork: boolean;
  startTime?: string; endTime?: string; breakHours?: number; workedHours?: number;
}
export interface Fields {
  pattern: string; reason: string; start: string; end: string; break: string; worked: string;
}
export interface PlannedDay { record: AttendanceRecord; kind: 'remote' | 'office' | 'paid'; expected: Fields }
export interface AttendanceCodes {
  workPatternCode: string; remoteReasonCode: string; officeReasonCode: string | null; paidLeaveReasonCode: string;
}
export class UserError extends Error {}
export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new UserError(message);
}
