import type { Page, FrameLocator, Locator } from 'playwright';
import { ensure, type Fields, type Period, type PlannedDay } from '../domain/attendance.js';
import { parseScreenPeriod } from '../utils/date.js';
import { equals, normalized } from '../services/validationService.js';
import type { Selectors, FieldKey } from './selectors.js';

export interface AttendancePort {
  assertPeriod(period: Period, confirmYear: () => Promise<boolean>): Promise<void>;
  read(day: PlannedDay): Promise<Fields>;
  write(day: PlannedDay): Promise<void>;
  verify(day: PlannedDay): Promise<Fields>;
  saveDraft(): Promise<void>;
}
async function unique(locator: Locator, label: string): Promise<Locator> {
  ensure(await locator.count() === 1 && await locator.isVisible(), `${label}: 要素がない、複数ある、または非表示です。`);
  return locator;
}
// Every click passes this guard. No submit/final-application API exists.
export async function safeClick(locator: Locator, draft = false): Promise<void> {
  await unique(locator, '操作対象');
  const names = await Promise.all([locator.getAttribute('aria-label'), locator.getAttribute('title'), locator.getAttribute('value'), locator.textContent()]);
  ensure(!names.some(n => n?.includes('申請')), '申請操作は禁止されています。');
  if (draft) {
    ensure(names.some(n => n?.trim() === '下書き保存'), '下書き保存ボタンの名称が一致しません。');
  } else {
    const submits = await locator.evaluate(el => (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.type === 'submit');
    ensure(!submits, '行編集にsubmitボタンは使用できません。');
  }
  await locator.click();
}
export class AttendancePage implements AttendancePort {
  readonly root: Page | FrameLocator;
  constructor(readonly page: Page, readonly selectors: Selectors) {
    this.root = selectors.frame ? page.frameLocator(selectors.frame) : page;
    page.setDefaultTimeout(selectors.timeoutMs);
  }
  async matches(): Promise<boolean> {
    const title = this.root.locator(this.selectors.title);
    return await title.count() === 1 && await title.isVisible() && (await title.innerText()).trim() === '勤務実績申請' && await this.draftButton().count() === 1;
  }
  draftButton() { return this.root.getByRole('button', { name: '下書き保存', exact: true }); }
  async assertPeriod(period: Period, confirmYear: () => Promise<boolean>): Promise<void> {
    ensure(await this.matches(), '勤務実績申請画面を確認できません。');
    const element = await unique(this.root.locator(this.selectors.period), '年月表示');
    const actual = parseScreenPeriod(await element.innerText());
    ensure(actual.month === period.month && (actual.year === undefined || actual.year === period.year), `対象年月が一致しません。Excel=${period.year}年${period.month}月 / 画面=${actual.year ?? '年不明'}年${actual.month}月`);
    if (actual.year === undefined) ensure(await confirmYear(), '年の追加確認が得られなかったため停止しました。');
  }
  async row(day: PlannedDay): Promise<Locator> {
    const month = Number(day.record.date.slice(5, 7));
    const pattern = new RegExp(`^\\s*0?${month}\\s*/\\s*0?${day.record.day}\\s*(?:[（(][^）)]*[）)])?\\s*$`);
    const rows = this.root.locator(this.selectors.rows).filter({ has: this.root.locator(this.selectors.dateCell).filter({ hasText: pattern }) });
    return unique(rows, `${day.record.date}の日付行`);
  }
  async read(day: PlannedDay): Promise<Fields> {
    const row = await this.row(day);
    const result = {} as Fields;
    for (const key of Object.keys(this.selectors.fields) as FieldKey[]) {
      const f = this.selectors.fields[key];
      const element = await unique(row.locator(f.read), `${day.record.date} ${key}`);
      result[key] = f.readMode === 'value' ? await element.inputValue() : await element.innerText();
    }
    return normalized(result);
  }
  async write(day: PlannedDay): Promise<void> {
    const row = await this.row(day);
    let scope: Locator = row;
    if (this.selectors.editButton) {
      await safeClick(row.locator(this.selectors.editButton));
      scope = this.root.locator(this.selectors.editor!);
      await scope.waitFor({ state: 'visible' });
      await unique(scope, '編集画面');
    }
    // Paid leave never writes ordinary start/end/break fields.
    const keys = day.kind === 'paid' ? ['pattern', 'reason'] as const : ['pattern', 'reason', 'start', 'end', 'break'] as const;
    for (const key of keys) {
      const f = this.selectors.fields[key];
      const input = await unique(scope.locator(f.input), `${key}入力欄`);
      const value = day.expected[key];
      if (f.control === 'select') await input.selectOption({ value });
      else if (f.control === 'fill') await input.fill(value);
      else {
        if (value === '') await safeClick(scope.locator(f.clear!));
        else {
          await safeClick(input);
          await safeClick(this.root.locator(f.option!.replaceAll('{code}', value)));
        }
      }
      if (f.control !== 'custom') await input.blur();
    }
    if (this.selectors.applyButton) {
      await safeClick(scope.locator(this.selectors.applyButton));
      await scope.waitFor({ state: 'hidden' });
    }
  }
  async verify(day: PlannedDay): Promise<Fields> {
    const deadline = Date.now() + this.selectors.timeoutMs;
    do {
      const actual = await this.read(day);
      if (equals(actual, day.expected)) return actual;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    ensure(false, `${day.record.date}: 入力後の値が期待値と一致しません。下書き保存しません。`);
  }
  async saveDraft(): Promise<void> {
    const success = this.root.locator(this.selectors.saveSuccess);
    // A pre-existing success message must never validate a new save.
    ensure(await success.count() <= 1, '保存完了表示が複数あります。');
    const before = await success.count() === 1 && await success.isVisible() ? (await success.innerText()).trim() : '';
    ensure(before !== this.selectors.saveSuccessText, '前回の保存完了表示が残っています。閉じてから再実行してください。');
    await safeClick(this.draftButton(), true);
    await success.waitFor({ state: 'visible', timeout: this.selectors.timeoutMs });
    const deadline = Date.now() + this.selectors.timeoutMs;
    do {
      if (await success.count() === 1 && (await success.innerText()).trim() === this.selectors.saveSuccessText) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    ensure(false, '下書き保存の成功を確認できません。Excelは退避しません。');
  }
}
