import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { AttendancePage, safeClick } from '../src/browser/attendancePage.js';
import { selectorsSchema } from '../src/browser/selectors.js';
import { buildPlan } from '../src/services/validationService.js';
import { enterAndSave, initialState } from '../src/services/attendanceService.js';
import { codes, period, record } from './helpers.js';
let browser: Browser;
const html = await readFile(new URL('./fixtures/attendance.html', import.meta.url), 'utf8');
const selectors = selectorsSchema.parse(JSON.parse(await readFile(new URL('./fixtures/selectors.json', import.meta.url), 'utf8')));
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(action: (page: Page, port: AttendancePage) => Promise<void>) {
  const page = await browser.newPage();
  try { await page.setContent(html); await action(page, new AttendancePage(page, selectors)); } finally { await page.close(); }
}
const stats = (p: Page) => p.evaluate(() => (window as any).stats);
test('日付で行を特定し在宅・出社事由消去・明示有休を入力、申請ゼロ', async () => fixture(async (page, port) => {
  await page.locator('[data-day="2"] [data-reason]').selectOption('007');
  const plan = buildPlan([record(1), record(2), record(3, false), record(4, false)], [2], [3], codes);
  const state = initialState();
  await enterAndSave(port, period, plan, '007', state, () => {}, async () => true);
  assert.equal(state.saved, true);
  assert.equal((await port.read(plan[0])).reason, '007');
  assert.equal((await port.read(plan[1])).reason, '');
  assert.equal((await port.read(plan[2])).reason, '040');
  assert.equal(await page.locator('[data-day="4"] [data-pattern]').inputValue(), '200');
  assert.equal(await page.locator('[data-day="11"] [data-start]').inputValue(), '');
  assert.equal((await stats(page)).applications, 0); assert.equal((await stats(page)).drafts, 1);
  const changes = (await stats(page)).changes;
  await page.locator('#saved').evaluate(el => { (el as HTMLElement).hidden = true; el.textContent = ''; });
  await enterAndSave(port, period, plan, '007', initialState(), () => {}, async () => true);
  assert.equal((await stats(page)).changes, changes);
  assert.equal((await stats(page)).applications, 0);
}));
test('年月不一致・年未確認時は書き込みも保存もしない', async () => fixture(async (page, port) => {
  const plan = buildPlan([record(1)], [], [], codes);
  await assert.rejects(() => enterAndSave(port, { year: 2026, month: 8 }, plan, '007', initialState(), () => {}, async () => true));
  await page.locator('#period').evaluate(el => el.textContent = '9月');
  await assert.rejects(() => enterAndSave(port, period, plan, '007', initialState(), () => {}, async () => false));
  assert.deepEqual(await stats(page), { applications: 0, drafts: 0, changes: 0 });
  await enterAndSave(port, period, plan, '007', initialState(), () => {}, async () => true);
  assert.equal((await stats(page)).drafts, 1);
}));
test('画面不一致・重複日付・既存入力競合は書き込み前に停止', async () => fixture(async (page, port) => {
  const plan = buildPlan([record(1), record(2)], [], [], codes);
  await page.locator('h1').evaluate(el => el.textContent = '別画面');
  await assert.rejects(() => port.assertPeriod(period, async () => true));
  await page.locator('h1').evaluate(el => el.textContent = '勤務実績申請');
  await page.locator('[data-day="2"] [data-start]').fill('10:00');
  await assert.rejects(() => enterAndSave(port, period, plan, '007', initialState(), () => {}, async () => true));
  assert.equal(await page.locator('[data-day="1"] [data-start]').inputValue(), '');
  await page.locator('[data-day="1"]').evaluate(el => el.parentElement!.append(el.cloneNode(true)));
  await assert.rejects(() => port.read(plan[0]));
  assert.equal((await stats(page)).drafts, 0);
}));
test('保存成功表示がない場合は成功扱いにせず、古い成功表示も拒否', async () => fixture(async (page, port) => {
  await page.evaluate(() => (window as any).failSave = true);
  const state = initialState();
  await assert.rejects(() => enterAndSave(port, period, buildPlan([record(1)], [], [], codes), '007', state, () => {}, async () => true));
  assert.equal(state.saved, false); assert.equal(state.saveAttempted, true);
  await page.locator('#saved').evaluate(el => { (el as HTMLElement).hidden = false; el.textContent = '下書き保存が完了しました'; });
  await assert.rejects(() => port.saveDraft());
  assert.equal((await stats(page)).drafts, 1); assert.equal((await stats(page)).applications, 0);
}));
test('最終申請クリックをガードし、誤ったセレクタでも拒否', async () => fixture(async (page) => {
  await assert.rejects(() => safeClick(page.getByRole('button', { name: '申請', exact: true })));
  await assert.rejects(() => safeClick(page.locator('#submit'), true));
  assert.equal((await stats(page)).applications, 0);
}));
test('計算結果の不一致は下書き保存しない', async () => fixture(async (page, port) => {
  await page.locator('[data-day="1"]').evaluate(el => el.addEventListener('change', () => el.querySelector('[data-worked]')!.textContent = '99.00'));
  await assert.rejects(() => enterAndSave(port, period, buildPlan([record(1)], [], [], codes), '007', initialState(), () => {}, async () => true));
  assert.equal((await stats(page)).drafts, 0);
}));
test('未校正の本番セレクタは受理しない', async () => {
  const config = JSON.parse(await readFile(new URL('../config/selectors.json', import.meta.url), 'utf8'));
  assert.equal(selectorsSchema.safeParse(config).success, false);
});
test('行の編集ダイアログ方式もセレクタ差し替えで入力できる', async () => fixture(async (page) => {
  await page.evaluate(() => {
    const dialog = document.createElement('section'); dialog.id = 'editor'; dialog.hidden = true;
    document.body.append(dialog);
    for (const row of document.querySelectorAll('tbody tr')) {
      const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.edit = ''; edit.textContent = '編集'; row.append(edit);
      edit.onclick = () => {
        dialog.innerHTML = '';
        for (const original of row.querySelectorAll('input,select')) {
          const clone = original.cloneNode(true) as HTMLInputElement; clone.value = (original as HTMLInputElement).value; dialog.append(clone);
        }
        const apply = document.createElement('button'); apply.id = 'apply'; apply.type = 'button'; apply.textContent = '確定'; dialog.append(apply);
        apply.onclick = () => {
          for (const key of ['pattern','reason','start','end','break']) {
            const target = row.querySelector(`[data-${key}]`) as HTMLInputElement;
            target.value = (dialog.querySelector(`[data-${key}]`) as HTMLInputElement).value;
          }
          row.dispatchEvent(new Event('change')); dialog.hidden = true;
        };
        dialog.hidden = false;
      };
    }
  });
  const port = new AttendancePage(page, { ...selectors, editor: '#editor', editButton: '[data-edit]', applyButton: '#apply' });
  const state = initialState();
  await enterAndSave(port, period, buildPlan([record(1)], [], [], codes), '007', state, () => {}, async () => true);
  assert.equal(state.saved, true); assert.equal((await stats(page)).applications, 0);
}));
