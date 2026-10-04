import { ensure, type Fields, type Period, type PlannedDay } from '../domain/attendance.js';
import type { AttendancePort } from '../browser/attendancePage.js';
import { conflicts, equals } from './validationService.js';
export interface RunState { stage: string; inputStarted: boolean; verified: boolean; saveAttempted: boolean; saved: boolean; backedUp: boolean }
export const initialState = (): RunState => ({ stage: '準備', inputStarted: false, verified: false, saveAttempted: false, saved: false, backedUp: false });
export async function verifySavedDraft(page: { reopenDraft(period: Period, plan: PlannedDay[]): Promise<void> }, period: Period, plan: PlannedDay[], state: RunState, log: (message: string) => void): Promise<void> {
  state.stage = '保存済み下書きの再表示・照合';
  state.verified = false; state.saved = false;
  await page.reopenDraft(period, plan);
  state.verified = true; state.saved = true;
  log('保存済み下書きの対象年月・全対象日の保存内容がExcelと一致しました。再入力・再保存はしていません。');
}
export async function enterAndSave(page: AttendancePort, period: Period, plan: PlannedDay[], remoteCode: string, state: RunState, log: (message: string) => void, confirmYear: () => Promise<boolean>): Promise<void> {
  ensure(plan.length > 0, '入力対象日がありません。');
  state.stage = '画面・年月確認';
  await page.assertPeriod(period, confirmYear);
  state.stage = '全対象日の既存値確認';
  const snapshot = new Map<number, Fields>();
  const errors: string[] = [];
  for (const day of plan) {
    const actual = await page.read(day);
    snapshot.set(day.record.day, actual);
    errors.push(...conflicts(actual, day, remoteCode));
  }
  for (const error of errors) log(`競合: ${error}`);
  ensure(!errors.length, '既存入力との競合があります。一切入力せず停止しました。');
  for (const [index, day] of plan.entries()) {
    state.stage = `${day.record.date} 入力`;
    // Recheck immediately before writing, protecting against changes after preflight.
    const actual = await page.read(day);
    ensure(JSON.stringify(actual) === JSON.stringify(snapshot.get(day.record.day)), `${day.record.date}: 確認後に画面の値が変わりました。`);
    if (equals(actual, day.expected)) log(`[${index + 1}/${plan.length}] ${day.record.date} ALREADY OK`);
    else {
      state.inputStarted = true;
      await page.write(day);
      await page.verify(day);
      log(`[${index + 1}/${plan.length}] ${day.record.date} ${day.kind} OK ${day.expected.start}-${day.expected.end}`);
    }
  }
  state.stage = '保存前の再検証';
  await page.assertPeriod(period, confirmYear);
  let count = 0, worked = 0, rest = 0, paid = 0;
  for (const day of plan) {
    const actual = await page.verify(day);
    if (day.kind === 'paid') paid++;
    else { count++; worked += Number(actual.worked); rest += Number(actual.break); }
  }
  const work = plan.filter(d => d.record.hasWork);
  ensure(count === work.length && Math.abs(worked - work.reduce((n, d) => n + d.record.workedHours!, 0)) < 0.02 && Math.abs(rest - work.reduce((n, d) => n + d.record.breakHours!, 0)) < 0.02, '通常勤務日数・実働・休憩の合計検証が失敗しました。');
  log(`入力結果確認（対象日）: 通常勤務 ${count}日 / 総労働 ${worked.toFixed(2)}時間 / 休憩 ${rest.toFixed(2)}時間 / 指定有休 ${paid}日 OK`);
  state.verified = true;
  state.stage = '下書き保存・成功確認';
  state.saveAttempted = true;
  await page.saveDraft(period, plan);
  state.saved = true;
  log('下書き保存の成功条件を確認しました。');
}
