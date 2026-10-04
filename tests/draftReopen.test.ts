import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { selectorsSchema, selectorsForRun } from '../src/browser/selectors.js';
import { executionMode } from '../src/domain/executionMode.js';
import { AttendancePage } from '../src/browser/attendancePage.js';
import { buildPlan } from '../src/services/validationService.js';
import { enterAndSave, verifySavedDraft, initialState } from '../src/services/attendanceService.js';
import { findAttendancePage } from '../src/browser/findAttendancePage.js';
import { isWholeMonthRange } from '../src/utils/date.js';
import { safeClick } from '../src/browser/interactions.js';
import { codes } from './helpers.js';
const html = await readFile(new URL('./fixtures/draftReopen.html', import.meta.url), 'utf8');
const base = JSON.parse(await readFile(new URL('./fixtures/selectors.json', import.meta.url), 'utf8'));
const live = JSON.parse(await readFile(new URL('../config/selectors.json', import.meta.url), 'utf8'));
base.fields.pattern.control = 'fill'; base.fields.reason.control = 'fill';
const config = selectorsSchema.parse({ ...base, rows: '#attendance tbody tr', saveMode: 'reopenDraft', saveSuccess: null, saveSuccessText: null,
  returnMarker: 'text="申請期間"', timeoutMs: 500,
  draftList: { ...live.draftList, entry: '.count', title: 'h1', loaded: '#loaded' }
});
const period = { year: 2032, month: 2 };
const plan = buildPlan([{ date: '2032-02-01', day: 1, hasWork: true, startTime: '10:15', endTime: '18:45', breakHours: 1.5, workedHours: 7 }], [], [], codes);
let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(mode: string, action: (page: Page, port: AttendancePage) => Promise<void>) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    await page.evaluate(mode => (window as any).testMode = mode, mode);
    await action(page, new AttendancePage(page, config));
  } finally { await page.close(); }
}
test('新規・既存下書きとも、対象期間の保存内容を再読取して成功にする', async () => {
  for (const mode of ['existing','new']) await fixture(mode, async (page, port) => {
    const state = initialState();
    await enterAndSave(port, period, plan, '007', state, () => {}, async () => false);
    assert.equal(state.saved, true);
    assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 1, opened: 1, deleted: 0 });
    assert.equal((await port.read(plan[0])).break, '1.50');
  });
});
test('件数があるだけで成功にせず、古い保存値なら退避条件を満たさない', async () => fixture('stale', async (page, port) => {
  const state = initialState();
  await assert.rejects(() => enterAndSave(port, period, plan, '007', state, () => {}, async () => false), /期待値/);
  assert.equal(state.saved, false); assert.equal(state.backedUp, false);
  assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 1, opened: 1, deleted: 0 });
}));
test('一覧の読込完了表示や入力ボタンが見えても全画面読込中にはクリックしない', async () => fixture('busyList', async (page) => {
  const port = new AttendancePage(page, { ...config, busy: live.busy, transitionTimeoutMs: 3000 });
  const state = initialState();
  await enterAndSave(port, period, plan, '007', state, () => {}, async () => false);
  assert.equal(state.saved, true);
  assert.equal(await page.evaluate(() => (window as any).ignoredClicks), 0);
  assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 1, opened: 1, deleted: 0 });
}));
test('全画面読込が終了しなければ一覧リンクを押さず期限で停止する', async () => fixture('busyStuck', async (page) => {
  const port = new AttendancePage(page, { ...config, busy: live.busy });
  const state = initialState();
  await assert.rejects(() => enterAndSave(port, period, plan, '007', state, () => {}, async () => false), /読込終了/);
  assert.equal(state.saved, false);
  assert.equal(await page.evaluate(() => (window as any).ignoredClicks), 0);
  assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 0, opened: 0, deleted: 0 });
}));
test('表示直後の初期化が終わり操作可能な状態が安定してから詳細を開く', async () => fixture('initializingList', async (page) => {
  const port = new AttendancePage(page, { ...config, transitionStableMs: 200, transitionTimeoutMs: 3000 });
  const state = initialState();
  await enterAndSave(port, period, plan, '007', state, () => {}, async () => false);
  assert.equal(state.saved, true);
  assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 1, opened: 1, deleted: 0 });
}));
test('遷移中のタイトル重複と遅れて現れる明細を待ち、保存や申請書入力を再クリックしない', async () => fixture('phasedEditor', async (page) => {
  const port = new AttendancePage(page, { ...config, transitionTimeoutMs: 3000 });
  const state = initialState();
  await enterAndSave(port, period, plan, '007', state, () => {}, async () => false);
  assert.equal(state.saved, true);
  assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 1, opened: 1, deleted: 0 });
}));
test('遷移中の重複が解消しない場合は期限で停止し、保存成功や再クリックにしない', async () => fixture('stuckEditor', async (page, port) => {
  const state = initialState();
  await assert.rejects(() => enterAndSave(port, period, plan, '007', state, () => {}, async () => false), /下書き再表示後.*再クリックはしていません/);
  assert.equal(state.saved, false); assert.equal(state.backedUp, false);
  assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 1, opened: 1, deleted: 0 });
}));
test('保存後の入口が遅れて表示されても待機し、非表示のテンプレートは操作しない', async () => {
  for (const mode of ['delayedEntry', 'hiddenTemplates']) await fixture(mode, async (page, port) => {
    const state = initialState();
    await enterAndSave(port, period, plan, '007', state, () => {}, async () => false);
    assert.equal(state.saved, true);
    assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 1, opened: 1, deleted: 0 });
  });
});
test('保存済み下書きの再確認では入力・保存をせず、一致した場合だけ退避可能にする', async () => {
  for (const matches of [true, false]) await fixture('existing', async (page) => {
    await page.evaluate(matches => {
      if (matches) (window as any).persisted = { pattern: '205', reason: '007', start: '10:15', end: '18:45', break: '1.50', worked: '7.00' };
      (window as any).returned();
    }, matches);
    const recovery = selectorsForRun(config, 'verifyDraft');
    assert.equal(recovery.verified, false);
    const port = await findAttendancePage(browser, recovery, 'verifyDraft', () => {});
    assert.equal(port.page, page);
    const state = initialState();
    if (matches) await verifySavedDraft(port, period, plan, state, () => {});
    else await assert.rejects(() => verifySavedDraft(port, period, plan, state, () => {}), /期待値/);
    assert.equal(state.saved, matches); assert.equal(state.verified, matches);
    assert.equal(state.inputStarted, false); assert.equal(state.saveAttempted, false);
    await assert.rejects(() => port.write(plan[0]), /未確認/);
    await assert.rejects(() => port.saveDraft(period, plan), /未確認/);
    const verifiedPort = new AttendancePage(page, config, 'verifyDraft');
    await assert.rejects(() => verifiedPort.write(plan[0]), /再確認専用/);
    await assert.rejects(() => verifiedPort.saveDraft(period, plan), /再確認専用/);
    assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 0, applications: 0, viewed: 1, opened: 1, deleted: 0 });
  });
});
test('下書き一覧専用の許可でもフォーム送信・明示submit・申請・削除を拒否する', async () => fixture('existing', async (page) => {
  await page.setContent('<form id="owner"></form><button id="entry">下書き:1件</button>');
  const entry = page.locator('#entry');
  await assert.rejects(() => safeClick(entry));
  await safeClick(entry, 'draftList'); // Omitted type, no form owner.
  await entry.evaluate(el => el.setAttribute('form', 'owner'));
  await assert.rejects(() => safeClick(entry, 'draftList'), /非送信/);
  await entry.evaluate(el => { el.removeAttribute('form'); el.setAttribute('type', 'submit'); });
  await assert.rejects(() => safeClick(entry, 'draftList'), /非送信/);
  await entry.evaluate(el => el.setAttribute('type', 'button'));
  for (const name of ['申請', '削除', '勤務実績申請', '下書き保存']) {
    await entry.evaluate((el, name) => el.textContent = name, name);
    await assert.rejects(() => safeClick(entry, 'draftList'), /名称/);
  }
}));
test('対象期間の重複・別月・承認待ち・部分期間を開かず停止する', async () => {
  for (const mode of ['duplicate','wrongMonth','approvedOnly','partial']) await fixture(mode, async (page, port) => {
    const state = initialState();
    await assert.rejects(() => enterAndSave(port, period, plan, '007', state, () => {}, async () => false), /一意/);
    assert.equal(state.saved, false);
    assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 0, opened: 0, deleted: 0 });
  });
});
test('保存後に遷移しなければ保存を繰り返さない', async () => fixture('noReturn', async (page, port) => {
  const state = initialState();
  await assert.rejects(() => enterAndSave(port, period, plan, '007', state, () => {}, async () => false));
  assert.equal(state.saved, false);
  assert.equal(await page.evaluate(() => (window as any).stats.saves), 1);
}));
test('下書きの申請期間は和暦・西暦の開始日と終了日を全月で照合する', () => {
  assert.equal(isWholeMonthRange('【申請期間】令和14年2月1日(日) ～ 令和14年2月29日(日)', period), true);
  assert.equal(isWholeMonthRange('2032年2月1日 ～ 2032年2月29日', period), true);
  for (const range of ['令和13年2月1日 ～ 令和13年2月28日', '令和14年2月1日 ～ 令和14年2月28日', '令和14年2月29日 ～ 令和14年2月1日', '2032年2月1日 ～ 2032年3月1日', '2/1～2/29']) assert.equal(isWholeMonthRange(range, period), false);
});
test('詳細表示失敗・入力ボタンの重複では再保存・申請・削除をしない', async () => {
  for (const mode of ['noDetails', 'duplicateEditor']) await fixture(mode, async (page, port) => {
    const state = initialState();
    await assert.rejects(() => enterAndSave(port, period, plan, '007', state, () => {}, async () => false));
    assert.equal(state.saved, false);
    assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 1, opened: 0, deleted: 0 });
  });
});
test('申請書入力後の年月が違えば保存確認済みにしない', async () => fixture('wrongEditor', async (page, port) => {
  const state = initialState();
  await assert.rejects(() => enterAndSave(port, period, plan, '007', state, () => {}, async () => false), /対象年月/);
  assert.equal(state.saved, false);
  assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 1, opened: 1, deleted: 0 });
}));
test('確認操作の例外でも申請・削除・送信ボタンと誤ったリンクを拒否する', async () => fixture('existing', async (page) => {
  await page.evaluate(() => { (window as any).list(); (window as any).details(); });
  for (const action of ['draftDetails', 'draftEditor'] as const) {
    for (const selector of ['#deleteDraft', '#detailSubmit']) await assert.rejects(() => safeClick(page.locator(selector), action));
  }
  const link = page.locator('a.js-tm-showItem').first();
  await assert.rejects(() => safeClick(link)); // Generic clicks keep rejecting the application name.
  await link.evaluate(el => el.setAttribute('href', '/submit'));
  await assert.rejects(() => safeClick(link, 'draftDetails'));
  const button = page.locator('#openEditor');
  await button.evaluate(el => el.setAttribute('type', 'submit'));
  await assert.rejects(() => safeClick(button, 'draftEditor'));
  await button.evaluate(el => { el.setAttribute('type', 'button'); el.setAttribute('aria-label', '申請'); });
  await assert.rejects(() => safeClick(button, 'draftEditor'));
  assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 0, applications: 0, viewed: 0, opened: 0, deleted: 0 });
}));
test('通しテストを明示した場合だけ未確認設定で入力・保存・再読取できる', async () => fixture('existing', async (page) => {
  const raw = { ...config, verified: false };
  assert.equal(executionMode([]), 'normal');
  assert.equal(executionMode(['--trial']), 'trial');
  assert.equal(executionMode(['--verify-draft']), 'verifyDraft');
  assert.throws(() => executionMode(['--trial', '--verify-draft']));
  assert.throws(() => executionMode(['--trial', '--unknown']));
  assert.throws(() => selectorsForRun(raw, 'normal'), /未確認/);
  assert.throws(() => selectorsForRun({ ...raw, draftList: null }, 'trial'), /不正/);
  const trial = selectorsForRun(raw, 'trial');
  const port = new AttendancePage(page, trial, 'trial');
  await page.locator('[data-pattern]').fill('200');
  const state = initialState();
  await enterAndSave(port, period, plan, '007', state, () => {}, async () => false);
  assert.equal(state.inputStarted, true); assert.equal(state.saved, true);
  assert.equal((await port.read(plan[0])).pattern, '205');
  assert.equal(trial.verified, false); assert.equal(raw.verified, false);
  assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 1, applications: 0, viewed: 1, opened: 1, deleted: 0 });
}));
test('通しテストでも年月違い・既存値競合の保護は維持する', async () => {
  for (const mismatch of ['period', 'conflict']) await fixture('existing', async (page) => {
    const port = new AttendancePage(page, selectorsForRun({ ...config, verified: false }, 'trial'), 'trial');
    if (mismatch === 'conflict') await page.locator('[data-start]').fill('11:00');
    const state = initialState();
    await assert.rejects(() => enterAndSave(port, mismatch === 'period' ? { year: 2033, month: 2 } : period, plan, '007', state, () => {}, async () => false));
    assert.equal(state.inputStarted, false); assert.equal(state.saved, false);
    assert.deepEqual(await page.evaluate(() => (window as any).stats), { saves: 0, applications: 0, viewed: 0, opened: 0, deleted: 0 });
  });
});
