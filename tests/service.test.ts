import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlan } from '../src/services/validationService.js';
import { enterAndSave, initialState } from '../src/services/attendanceService.js';
import { backupFile, fingerprint } from '../src/services/backupService.js';
import type { AttendancePort } from '../src/browser/attendancePage.js';
import type { Fields, PlannedDay } from '../src/domain/attendance.js';
import { codes, period, record } from './helpers.js';
const plan = buildPlan([record(1), record(2)], [], [], codes);
function fake(failure = '') {
  let writes = 0, saves = 0;
  const data = new Map<number, Fields>(plan.map(d => [d.record.day, { pattern: '200', reason: '', start: '', end: '', break: '', worked: '' }]));
  const port: AttendancePort = {
    async assertPeriod() { if (failure === 'period') throw Error('period'); },
    async read(d) { return { ...data.get(d.record.day)! }; },
    async write(d) { writes++; if (failure === 'write') throw Error('write'); data.set(d.record.day, d.expected); },
    async verify(d) { if (failure === 'verify') throw Error('verify'); return data.get(d.record.day)!; },
    async saveDraft() { saves++; if (failure === 'save') throw Error('save'); }
  };
  return { port, data, writes: () => writes, saves: () => saves };
}
test('全対象日の競合確認は最初の書き込みより前', async () => {
  const f = fake(); f.data.get(2)!.start = '10:00';
  await assert.rejects(() => enterAndSave(f.port, period, plan, '007', initialState(), () => {}, async () => true));
  assert.equal(f.writes(), 0); assert.equal(f.saves(), 0);
});
test('失敗箇所に応じて保存とバックアップ条件を満たさない', async () => {
  for (const stage of ['period', 'write', 'verify', 'save']) {
    const f = fake(stage), state = initialState();
    await assert.rejects(() => enterAndSave(f.port, period, plan, '007', state, () => {}, async () => true));
    assert.equal(state.saved, false);
    assert.equal(f.saves(), stage === 'save' ? 1 : 0);
  }
});
test('既存一致は再入力せず、検証後に下書きのみ保存', async () => {
  const f = fake(); for (const d of plan) f.data.set(d.record.day, d.expected);
  const state = initialState();
  await enterAndSave(f.port, period, plan, '007', state, () => {}, async () => true);
  assert.equal(f.writes(), 0); assert.equal(f.saves(), 1); assert.equal(state.saved, true);
});
test('入力後の変更を検知し、保存しない', async () => {
  const f = fake(); const read = f.port.read; let calls = 0;
  f.port.read = async (d: PlannedDay) => { const result = await read(d); if (++calls === 3) result.reason = '040'; return result; };
  await assert.rejects(() => enterAndSave(f.port, period, plan, '007', initialState(), () => {}, async () => true));
  assert.equal(f.writes(), 0); assert.equal(f.saves(), 0);
});
test('成功後のみ移動し、失敗・衝突・元ファイル変更時にはinputを残す', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bugyo-backup-')), input = join(dir, 'input'), back = join(dir, 'filesback');
  await mkdir(input);
  const file = join(input, '202609_sample.xls'); await writeFile(file, 'sample');
  const hash = await fingerprint(file), state = initialState();
  const save = () => backupFile(file, input, back, 'yyyyMMddHHmmss', hash, state, new Date('2026-10-03T15:36:42Z'));
  try {
    await assert.rejects(save); await access(file);
    state.verified = state.saved = true;
    const target = await save(); assert.equal(target, join(back, '20261004003642', '202609_sample.xls'));
    await access(target); await assert.rejects(() => access(file));
    await writeFile(file, 'sample'); state.backedUp = false;
    await assert.rejects(save); await access(file); assert.equal(state.saved, true); assert.equal(state.backedUp, false);
    await writeFile(file, 'changed'); await assert.rejects(save); await access(file);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
