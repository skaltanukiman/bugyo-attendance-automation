import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { inspectionSelectorsSchema, selectorsSchema } from '../src/browser/selectors.js';
import { AttendancePage } from '../src/browser/attendancePage.js';
import { inspectScreen } from '../src/services/screenInspection.js';

const base = JSON.parse(await readFile(new URL('./fixtures/selectors.json', import.meta.url), 'utf8'));
const config = inspectionSelectorsSchema.parse({ ...base, verified: false, periodSource: 'rowDates', period: null,
  rows: 'tr[data-row]:has(input[data-labordate])', dateEvidence: { selector: '[data-labordate]', attribute: 'data-labordate' } });
const period = { year: 2032, month: 2 };
let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(action: (page: Page, port: AttendancePage) => Promise<void>) {
  const page = await browser.newPage();
  const rows = Array.from({ length: 29 }, (_, index) => `<tr data-row data-day="${index + 1}">
    <td data-date>2/${index + 1} (日)<input type="checkbox" data-labordate="2032/02/${String(index + 1).padStart(2, '0')} 0:00:00"></td>
    <td><input data-pattern value="205"></td><td><input data-reason value="007"></td>
    <td><input data-start value="10:15"></td><td><input data-end value="18:45"></td>
    <td><input data-break value="1.50"></td><td data-worked>7.00</td></tr>`).join('');
  try {
    await page.setContent(`<h1>勤務実績申請</h1><table><tbody>${rows}<tr data-row><td>架空集計</td></tr></tbody></table><button type="button">下書き保存</button><button type="button">申請</button>`);
    await page.evaluate(() => {
      (window as any).actions = 0;
      for (const type of ['click', 'input', 'change']) document.addEventListener(type, () => (window as any).actions++);
    });
    await action(page, new AttendancePage(page, config));
    assert.equal(await page.evaluate(() => (window as any).actions), 0);
  } finally { await page.close(); }
}
test('verified=falseは読取専用で受理し、通常実行・入力・保存は拒否する', async () => fixture(async (page, port) => {
  assert.equal(selectorsSchema.safeParse(config).success, false);
  const before = await page.content();
  await assert.rejects(() => port.saveDraft(), /未確認/);
  await assert.rejects(() => port.write({ record: { date: '2032-02-01', day: 1, hasWork: false }, kind: 'remote', expected: { pattern: '', reason: '', start: '', end: '', break: '', worked: '' } }), /未確認/);
  assert.equal(await page.content(), before);
  assert.equal(config.verified, false);
}));
test('全日付と6項目を読み取って確認日を返し、画面も検証済みフラグも変更しない', async () => fixture(async (page, port) => {
  const before = await page.content();
  assert.deepEqual(await inspectScreen(port, period, 1), { days: 29, sample: { pattern: '205', reason: '007', start: '10:15', end: '18:45', break: '1.50', worked: '7.00' } });
  assert.equal(await page.content(), before);
  assert.equal(config.verified, false);
}));
test('日付欠落・重複・別年・読取項目欠落では確認成功にしない', async () => {
  for (const mode of ['missing', 'duplicate', 'foreignYear', 'missingField']) await fixture(async (page, port) => {
    await page.locator('[data-day="2"]').evaluate((el, mode) => {
      if (mode === 'missing') el.querySelector('[data-labordate]')!.removeAttribute('data-labordate');
      if (mode === 'duplicate') el.parentElement!.append(el.cloneNode(true));
      if (mode === 'foreignYear') el.querySelector('[data-labordate]')!.setAttribute('data-labordate', '2031/02/02 0:00:00');
      if (mode === 'missingField') el.querySelector('[data-worked]')!.removeAttribute('data-worked');
    }, mode);
    await assert.rejects(() => inspectScreen(port, period, 1));
    assert.equal(config.verified, false);
  });
});
