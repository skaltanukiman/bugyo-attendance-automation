import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { AttendancePage } from '../src/browser/attendancePage.js';
import { selectorsSchema } from '../src/browser/selectors.js';
import { timeParts, readTimeParts, decimalParts } from '../src/browser/splitInput.js';
import { buildPlan } from '../src/services/validationService.js';
import { enterAndSave, initialState } from '../src/services/attendanceService.js';
import { codes } from './helpers.js';

// Generated fictional records; no captured HTML or real row keys are included.
const settings = JSON.parse(await readFile(new URL('../config/selectors.json', import.meta.url), 'utf8'));
const selectors = selectorsSchema.parse({ ...settings, verified: true, title: 'h1', periodSource: 'display', period: '#period', saveMode: 'message', draftList: null, saveSuccess: '#saved', saveSuccessText: 'テスト下書き完了', timeoutMs: 1000 });
const period = { year: 2032, month: 2 };
const plan = buildPlan([{ date: '2032-02-01', day: 1, hasWork: true, startTime: '10:15', endTime: '18:45', breakHours: 1.5, workedHours: 7 }], [], [], codes);
let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(action: (page: import('playwright').Page, port: AttendancePage) => Promise<void>) {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<h1>勤務実績申請</h1><p id="period">2032年2月</p><table id="table"><tbody></tbody></table><button type="button" id="submit">申請</button><button type="button" id="save">下書き保存</button><p id="saved" hidden></p>');
    await page.evaluate(() => {
      const w = window as any; w.applied = 0; w.saved = 0; w.commits = 0;
      for (const day of [2, 1]) {
        const row = document.createElement('tr'); row.className = 'js-cm-scrTbl__innerTr'; row.dataset.testday = String(day);
        row.innerHTML = `<td><table><tbody><tr id="duplicate-${day}"><td><input type="checkbox" data-labordate="2032/02/0${day} 0:00:00"></td><td class="js-inputTableDate">2/ ${day} (日)</td></tr></tbody></table></td><td><table><tbody><tr id="duplicate-${day}">
          <td data-ctype="sys" data-code="200">200 テスト勤務</td>
          <td data-ctype="res" data-code1="" data-code2="" data-code3="" data-code4="" data-code5=""></td>
          <td data-custom-label="出勤時刻"></td><td data-custom-label="退出時刻"></td>
          <td data-key="fake-${day}-TimeSpan.17.InputedSpan"></td><td data-key="fake-${day}-TimeSpan.20.InputedSpan"></td>
        </tr></tbody></table></td>`;
        document.querySelector('#table > tbody')!.append(row);
        for (const key of ['pattern', 'reason', 'start', 'end', 'break']) {
          const query = key === 'pattern' ? '[data-ctype="sys"]' : key === 'reason' ? '[data-ctype="res"]' : key === 'start' ? '[data-custom-label="出勤時刻"]' : key === 'end' ? '[data-custom-label="退出時刻"]' : '[data-key$="-TimeSpan.17.InputedSpan"]';
          const cell = row.querySelector(query) as HTMLElement; cell.dataset.testfield = key;
          cell.addEventListener('click', () => {
            if (cell.querySelector('input')) return;
            row.dispatchEvent(new Event('commit-edit'));
            const old = cell.textContent!;
            if (key === 'pattern' || key === 'reason') {
              const value = cell.getAttribute(key === 'pattern' ? 'data-code' : 'data-code1')!;
              cell.innerHTML = `<input id="${key === 'pattern' ? 'sys-code' : 'res-code'}" value="">`;
              (cell.querySelector('input') as HTMLInputElement).value = value;
            } else if (key === 'break') {
              const [hour = '', fraction = ''] = old.split('.');
              cell.innerHTML = '<div id="spanBox-span"><input id="spanTotalHours"><span>.</span><input id="spanMinutes"></div>';
              (cell.querySelector('#spanTotalHours') as HTMLInputElement).value = hour;
              (cell.querySelector('#spanMinutes') as HTMLInputElement).value = fraction;
            } else {
              cell.innerHTML = '<div id="time"><input data-type="type" value="1"><input data-type="hour"><span>:</span><input data-type="minute"></div>';
            }
          });
        }
        row.addEventListener('commit-edit', () => {
          if (w.blockCommit) return;
          for (const cell of row.querySelectorAll<HTMLElement>('[data-testfield]')) {
            if (!cell.querySelector('input')) continue;
            const key = cell.dataset.testfield;
            let text = '';
            if (key === 'pattern' || key === 'reason') { text = cell.querySelector('input')!.value; cell.setAttribute(key === 'pattern' ? 'data-code' : 'data-code1', text); }
            else if (key === 'break') text = `${cell.querySelector<HTMLInputElement>('#spanTotalHours')!.value}.${cell.querySelector<HTMLInputElement>('#spanMinutes')!.value}`;
            else text = `${String(Number(cell.querySelector<HTMLInputElement>('[data-type="hour"]')!.value) + (cell.querySelector<HTMLInputElement>('[data-type="type"]')!.value === '2' ? 24 : 0)).padStart(2, '0')}:${cell.querySelector<HTMLInputElement>('[data-type="minute"]')!.value}`;
            cell.textContent = text; w.commits++;
          }
          const start = row.querySelector('[data-testfield="start"]')!.textContent!;
          const end = row.querySelector('[data-testfield="end"]')!.textContent!;
          const rest = row.querySelector('[data-testfield="break"]')!.textContent!;
          if (start && end && rest) {
            const [sh, sm] = start.split(':').map(Number), [eh, em] = end.split(':').map(Number);
            row.querySelector('[data-key$="-TimeSpan.20.InputedSpan"]')!.textContent = (eh + em / 60 - sh - sm / 60 - Number(rest)).toFixed(2);
          }
        });
      }
      document.querySelector('#submit')!.addEventListener('click', () => w.applied++);
      document.querySelector('#save')!.addEventListener('click', () => { w.saved++; const el = document.querySelector('#saved') as HTMLElement; el.hidden = false; el.textContent = 'テスト下書き完了'; });
    });
    try { await action(page, new AttendancePage(page, selectors)); }
    catch (error) { if (errors.length) throw new Error(errors.join('\n')); throw error; }
    assert.deepEqual(errors, [], '模擬画面内のJavaScriptエラー');
  } finally { await page.close(); }
}
test('分割セルを開いて入力・確定し、左右に分かれた日付行を正しく検証する', async () => fixture(async (page, port) => {
  await page.locator('[data-testday="1"] [data-ctype="sys"]').click(); // live value differs from HTML value attribute
  assert.equal((await port.read(plan[0])).pattern, '200');
  const state = initialState();
  await enterAndSave(port, period, plan, '007', state, () => {}, async () => false);
  assert.equal(state.saved, true);
  assert.equal((await port.read(plan[0])).break, '1.50');
  assert.equal(await page.locator('[data-testday="2"] [data-ctype="sys"]').getAttribute('data-code'), '200');
  assert.deepEqual(await page.evaluate(() => ({ applied: (window as any).applied, saved: (window as any).saved })), { applied: 0, saved: 1 });
  assert.ok(await page.evaluate(() => (window as any).commits > 0));
}));
test('行の年月日属性が別年なら入力せず停止する', async () => fixture(async (page, port) => {
  await page.locator('[data-testday="1"] [data-labordate]').evaluate(el => el.setAttribute('data-labordate', '2031/02/01 0:00:00'));
  await assert.rejects(() => enterAndSave(port, period, plan, '007', initialState(), () => {}, async () => true));
  assert.equal(await page.evaluate(() => (window as any).commits), 0);
}));
test('複数事由と未確定のコード入力を上書きしない', async () => fixture(async (page, port) => {
  const cell = page.locator('[data-testday="1"] [data-ctype="res"]');
  await cell.evaluate(el => el.setAttribute('data-code2', '999'));
  await assert.rejects(() => port.read(plan[0]), /複数事由/);
  await cell.evaluate(el => el.setAttribute('data-code2', ''));
  await cell.click(); await cell.locator('input').fill('999');
  await assert.rejects(() => port.read(plan[0]), /未確定/);
  assert.equal(await page.evaluate(() => (window as any).commits), 0);
}));
test('確定しても入力欄が閉じない場合は保存しない', async () => fixture(async (page, port) => {
  await page.evaluate(() => (window as any).blockCommit = true);
  await assert.rejects(() => enterAndSave(port, period, plan, '007', initialState(), () => {}, async () => false));
  assert.equal(await page.evaluate(() => (window as any).saved), 0);
}));
test('時刻や休憩が編集中なら表示文字だけで空欄や確定済みと判断しない', async () => fixture(async (page, port) => {
  await page.locator('[data-testday="1"] [data-custom-label="出勤時刻"]').click();
  await assert.rejects(() => port.read(plan[0]), /編集中/);
  assert.equal(await page.evaluate(() => (window as any).commits), 0);
}));
test('翌日を時刻と別に表現し、小数時間を60進の分へ変換しない', () => {
  assert.deepEqual(timeParts('25:30'), { dayType: '2', hour: '01', minute: '30' });
  assert.equal(readTimeParts('2', '01', '30'), '25:30');
  assert.deepEqual(decimalParts('1.50'), { hour: '1', fraction: '50' });
  assert.throws(() => timeParts('48:00'));
  assert.throws(() => readTimeParts('0', '23', '00'));
});
test('年月表示なしでも全行の年月日属性で対象月を照合する', async () => fixture(async (page) => {
  await page.locator('#period').evaluate(el => el.remove());
  await page.evaluate(() => {
    const source = document.querySelector('[data-testday="2"]')!;
    for (let day = 3; day <= 29; day++) {
      const clone = source.cloneNode(true) as HTMLElement;
      clone.dataset.testday = String(day);
      clone.querySelector('[data-labordate]')!.setAttribute('data-labordate', `2032/02/${String(day).padStart(2, '0')} 0:00:00`);
      clone.querySelector('.js-inputTableDate')!.textContent = `2/ ${day} (日)`;
      source.parentElement!.append(clone);
    }
  });
  const port = new AttendancePage(page, { ...selectors, title: settings.title, period: null, periodSource: 'rowDates' });
  await port.assertPeriod(period, async () => { throw Error('属性で年が分かるので追加確認は不要'); });
  await assert.rejects(() => port.assertPeriod({ year: 2031, month: 2 }, async () => true), /対象年月/);
  await page.locator('[data-testday="3"] [data-labordate]').evaluate(el => el.setAttribute('data-labordate', '2032/03/03 0:00:00'));
  await assert.rejects(() => port.assertPeriod(period, async () => true), /対象年月/);
  assert.equal(await page.evaluate(() => (window as any).commits), 0);
}));
test('年月の取得元が不十分または日付表示と矛盾する場合は停止', async () => fixture(async (page) => {
  const port = new AttendancePage(page, { ...selectors, period: null, periodSource: 'rowDates' });
  await assert.rejects(() => port.assertPeriod(period, async () => true), /全日付/);
  await page.locator('[data-testday="1"] .js-inputTableDate').evaluate(el => el.textContent = '2/ 11 (日)');
  await assert.rejects(() => port.assertPeriod(period, async () => true), /表示と属性/);
  assert.equal(selectorsSchema.safeParse({ ...selectors, period: null, periodSource: 'display' }).success, false);
  assert.equal(selectorsSchema.safeParse({ ...selectors, periodSource: 'rowDates', dateEvidence: undefined }).success, false);
}));
