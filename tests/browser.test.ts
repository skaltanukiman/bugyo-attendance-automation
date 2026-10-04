import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { AttendancePage, safeClick } from '../src/browser/attendancePage.js';
import { findAttendancePage } from '../src/browser/findAttendancePage.js';
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
test('確認済みの本番設定を受理し、未確認に戻した設定は拒否する', async () => {
  const config = JSON.parse(await readFile(new URL('../config/selectors.json', import.meta.url), 'utf8'));
  assert.equal(selectorsSchema.safeParse(config).success, true);
  assert.equal(selectorsSchema.safeParse({ ...config, verified: false }).success, false);
});
test('非表示の同名タイトルとボタンを除外して入力画面を識別する', async () => fixture(async page => {
  await page.evaluate(() => {
    const template = document.createElement('section'); template.hidden = true;
    template.innerHTML = '<p>勤務実績申請</p><div>勤務実績申請</div><button type="button">下書き保存</button>';
    document.body.append(template);
  });
  const config = { ...selectors, title: 'text="勤務実績申請"' };
  const log: string[] = [];
  const port = await findAttendancePage(browser, config, 'normal', message => log.push(message));
  assert.deepEqual(await port.identificationCounts(), { titles: 3, visibleTitles: 1, draftButtons: 1, rows: 5 });
  await port.assertPeriod(period, async () => true);
  assert.match(log[0], /タイトル=3（表示中1）/);
  assert.deepEqual(await stats(page), { applications: 0, drafts: 0, changes: 0 });
}));
test('表示タイトルが複数・候補タブが複数なら件数を示して入力前に停止する', async () => fixture(async page => {
  const config = { ...selectors, title: 'text="勤務実績申請"' };
  await page.evaluate(() => {
    const extra = document.createElement('p'); extra.id = 'extraTitle'; extra.textContent = '勤務実績申請'; document.body.append(extra);
  });
  const log: string[] = [];
  await assert.rejects(() => findAttendancePage(browser, config, 'normal', message => log.push(message)), /候補が0件/);
  assert.match(log[0], /表示中2/);
  await page.locator('#extraTitle').evaluate(el => el.remove());
  const second = await browser.newPage();
  try {
    await second.setContent(html);
    await assert.rejects(() => findAttendancePage(browser, config, 'normal', () => {}), /候補が2件/);
    assert.deepEqual(await stats(page), { applications: 0, drafts: 0, changes: 0 });
    assert.deepEqual(await stats(second), { applications: 0, drafts: 0, changes: 0 });
  } finally { await second.close(); }
}));
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
const countSelectors = selectorsSchema.parse({ ...selectors, saveMode: 'countAndReturn', saveSuccess: null, saveSuccessText: null,
  draftCount: 'text=/^下書き\\s*[:：]\\s*[0-9]+\\s*件$/', returnMarker: 'text="申請期間"', timeoutMs: 400 });
async function countFixture(page: Page, before: number, after: number, mode = 'return') {
  await page.evaluate(({ before, after, mode }) => {
    const badge = document.createElement('div'); badge.id = 'draft-count'; badge.textContent = `下書き:${before}件`; document.body.prepend(badge);
    (document.querySelector('#draft') as HTMLButtonElement).onclick = () => {
      (window as any).stats.drafts++;
      if (mode !== 'stay') document.body.innerHTML = '';
      if (mode !== 'stay') { const count = document.createElement('div'); count.id = 'draft-count'; document.body.append(count); }
      document.querySelector('#draft-count')!.textContent = `下書き:${after}件`;
      if (mode !== 'missingMarker') { const label = document.createElement('p'); label.textContent = '申請期間'; document.body.append(label); }
    };
  }, { before, after, mode });
}
test('新しい下書き件数と入力画面からの遷移を両方確認して保存成功とする', async () => {
  for (const before of [0, 3]) await fixture(async page => {
    await countFixture(page, before, before + 1);
    await new AttendancePage(page, countSelectors).saveDraft();
    assert.equal((await stats(page)).drafts, 1); assert.equal((await stats(page)).applications, 0);
  });
});
test('件数不変・想定外増加・遷移未確認では成功にせず再クリックもしない', async () => {
  for (const [after, mode] of [[1, 'return'], [3, 'return'], [2, 'missingMarker'], [2, 'stay']] as const) await fixture(async page => {
    await countFixture(page, 1, after, mode);
    await assert.rejects(() => new AttendancePage(page, countSelectors).saveDraft(), /1件増加/);
    assert.equal((await stats(page)).drafts, 1); assert.equal((await stats(page)).applications, 0);
  });
});
test('保存前に件数が取得できなければ保存ボタンを押さない', async () => fixture(async page => {
  await assert.rejects(() => new AttendancePage(page, countSelectors).saveDraft(), /下書き件数/);
  assert.equal((await stats(page)).drafts, 0);
}));
test('ページ全体の遷移後にも下書き件数を読み直して保存を確認する', async () => fixture(async page => {
  let requests = 0;
  await page.route('http://127.0.0.1:18765/result', async route => {
    requests++;
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><p>下書き:1件</p><label>申請期間</label>' });
  });
  await countFixture(page, 0, 1);
  await page.evaluate(() => {
    (document.querySelector('#draft') as HTMLButtonElement).onclick = () => { location.href = 'http://127.0.0.1:18765/result'; };
  });
  await new AttendancePage(page, { ...countSelectors, timeoutMs: 2000 }).saveDraft();
  assert.equal(requests, 1);
  assert.equal(page.url(), 'http://127.0.0.1:18765/result');
}));
