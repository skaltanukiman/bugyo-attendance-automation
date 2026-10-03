import type { Page, FrameLocator, Locator } from 'playwright';
import { ensure, type Fields, type Period, type PlannedDay } from '../domain/attendance.js';
import type { ExecutionMode } from '../domain/executionMode.js';
import { daysInMonth, parseScreenPeriod } from '../utils/date.js';
import { equals, normalize, normalized } from '../services/validationService.js';
import type { InspectionSelectors, FieldKey } from './selectors.js';
import { timeParts, decimalParts } from './splitInput.js';
import { safeClick, unique } from './interactions.js';
import { DraftListPage } from './draftListPage.js';
export { safeClick } from './interactions.js';

export interface AttendancePort {
  assertPeriod(period: Period, confirmYear: () => Promise<boolean>): Promise<void>;
  read(day: PlannedDay): Promise<Fields>;
  write(day: PlannedDay): Promise<void>;
  verify(day: PlannedDay): Promise<Fields>;
  saveDraft(period?: Period, plan?: PlannedDay[]): Promise<void>;
}
export class AttendancePage implements AttendancePort {
  readonly root: Page | FrameLocator;
  private readonly openedCodeValues = new Map<string, string>();
  constructor(readonly page: Page, readonly selectors: InspectionSelectors, readonly mode: ExecutionMode = 'normal') {
    this.root = selectors.frame ? page.frameLocator(selectors.frame) : page;
    page.setDefaultTimeout(selectors.timeoutMs);
  }
  async matches(): Promise<boolean> {
    const title = this.pageTitle();
    return await title.count() === 1 && await title.isVisible() && (await title.innerText()).trim() === '勤務実績申請' && await this.draftButton().count() === 1;
  }
  pageTitle() { return this.root.locator(this.selectors.title).filter({ visible: true }); }
  async identificationCounts(): Promise<{ titles: number; visibleTitles: number; draftButtons: number; rows: number }> {
    return { titles: await this.root.locator(this.selectors.title).count(), visibleTitles: await this.pageTitle().count(),
      draftButtons: await this.draftButton().count(), rows: await this.root.locator(this.selectors.rows).count() };
  }
  draftButton() { return this.root.getByRole('button', { name: '下書き保存', exact: true }); }
  async assertPeriod(period: Period, confirmYear: () => Promise<boolean>): Promise<void> {
    ensure(await this.matches(), '勤務実績申請画面を確認できません。');
    if (this.selectors.periodSource === 'rowDates') {
      const evidence = this.selectors.dateEvidence!;
      const rows = this.root.locator(this.selectors.rows);
      const dates = new Set<number>();
      for (const row of await rows.all()) {
        const element = row.locator(evidence.selector);
        ensure(await element.count() === 1, '日付行の年月日属性がない、または複数あります。');
        const value = await element.getAttribute(evidence.attribute);
        const match = value?.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s+0:00:00)?$/);
        ensure(match && Number(match[1]) === period.year && Number(match[2]) === period.month, 'Excelと画面の日付行の対象年月が一致しません。');
        const day = Number(match[3]);
        ensure(day >= 1 && day <= daysInMonth(period) && !dates.has(day), '日付行に不正日付または重複があります。');
        const display = await unique(row.locator(this.selectors.dateCell), '日付表示');
        ensure(new RegExp(`^\\s*0?${period.month}\\s*/\\s*0?${day}\\s*(?:[（(][^）)]*[）)])?\\s*$`).test(await display.innerText()), '日付の表示と属性が一致しません。');
        dates.add(day);
      }
      ensure(dates.size === daysInMonth(period), '対象月の全日付を確認できません。入力は開始しません。');
      return;
    }
    const element = await unique(this.root.locator(this.selectors.period!), '年月表示');
    const actual = parseScreenPeriod(await element.innerText());
    ensure(actual.month === period.month && (actual.year === undefined || actual.year === period.year), `対象年月が一致しません。Excel=${period.year}年${period.month}月 / 画面=${actual.year ?? '年不明'}年${actual.month}月`);
    if (actual.year === undefined) ensure(await confirmYear(), '年の追加確認が得られなかったため停止しました。');
  }
  async row(day: PlannedDay): Promise<Locator> {
    const month = Number(day.record.date.slice(5, 7));
    const pattern = new RegExp(`^\\s*0?${month}\\s*/\\s*0?${day.record.day}\\s*(?:[（(][^）)]*[）)])?\\s*$`);
    const rows = this.root.locator(this.selectors.rows).filter({ has: this.root.locator(this.selectors.dateCell).filter({ hasText: pattern }) });
    const row = await unique(rows, `${day.record.date}の日付行`);
    if (this.selectors.dateEvidence) {
      const config = this.selectors.dateEvidence;
      const evidence = row.locator(config.selector);
      ensure(await evidence.count() === 1, '日付属性を一意に確認できません。');
      const text = await evidence.getAttribute(config.attribute);
      const match = text?.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s+0:00:00)?$/);
      ensure(match && `${match[1]}-${match[2]}-${match[3]}` === day.record.date, '日付表示と年月日属性が一致しません。');
    }
    return row;
  }
  async read(day: PlannedDay): Promise<Fields> {
    const row = await this.row(day);
    const result = {} as Fields;
    for (const key of Object.keys(this.selectors.fields) as FieldKey[]) {
      const f = this.selectors.fields[key];
      const element = await unique(row.locator(f.read), `${day.record.date} ${key}`);
      for (const attribute of f.emptyAttributes ?? []) {
        const extra = await element.getAttribute(attribute);
        ensure(extra === '', `${key}: 複数事由または未確認の属性状態があるため停止します。`);
      }
      if ('activate' in f && f.activate && await row.locator(f.input).count() && f.readMode === 'text' && (key === 'pattern' || key === 'reason')) {
        const input = await unique(row.locator(f.input), '編集中のコード入力欄');
        const live = normalize(key, await input.inputValue());
        const baseline = this.openedCodeValues.get(`${day.record.date}:${key}`);
        ensure(baseline !== undefined && live === baseline, `${key}: 未確定の手入力があります。確定または取消後に再実行してください。`);
        result[key] = live;
        continue;
      }
      if (f.readMode === 'attribute') {
        const value = await element.getAttribute(f.readAttribute!);
        ensure(value !== null, `${key}: 読取属性がありません。`);
        result[key] = value;
      } else result[key] = f.readMode === 'value' ? await element.inputValue() : await element.innerText();
      if ('activate' in f && f.activate && await row.locator(f.input).count()) {
        ensure(f.readMode === 'attribute', `${key}: セルが編集中です。確定または取消後に再実行してください。`);
        const input = await unique(row.locator(f.input), '編集中の入力欄');
        ensure(f.control === 'fill' || f.control === 'select', `${key}: 編集中の分割入力は読み取れません。`);
        const live = await input.inputValue();
        // Never treat a manually edited but uncommitted value as persisted data.
        ensure(normalize(key, live) === normalize(key, result[key]), `${key}: 未確定の手入力があります。確定または取消後に再実行してください。`);
      }
    }
    return normalized(result);
  }
  private async trackCodeEditor(scope: Locator, day: PlannedDay, key: FieldKey): Promise<void> {
    if (key !== 'pattern' && key !== 'reason') return;
    const f = this.selectors.fields[key];
    if (!f.activate || f.readMode !== 'text') return;
    const token = `${day.record.date}:${key}`;
    const input = scope.locator(f.input);
    if (await input.count()) {
      const live = normalize(key, await (await unique(input, 'コード入力欄')).inputValue());
      ensure(this.openedCodeValues.has(token) && live === this.openedCodeValues.get(token), `${key}: 未確定の手入力があります。`);
    } else {
      const cell = await unique(scope.locator(f.read), 'コード表示');
      this.openedCodeValues.set(token, normalize(key, await cell.innerText()));
    }
  }
  async write(day: PlannedDay): Promise<void> {
    ensure(this.selectors.verified || this.mode === 'trial', '未確認のセレクタでは入力できません。');
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
      if (f.activate) {
        await this.trackCodeEditor(scope, day, key);
        await safeClick(scope.locator(f.activate));
      }
      await scope.locator(f.input).waitFor({ state: 'visible' });
      const input = await unique(scope.locator(f.input), `${key}入力欄`);
      const value = day.expected[key];
      if (f.control === 'select') await input.selectOption({ value });
      else if (f.control === 'fill') await input.fill(value);
      else if (f.control === 'splitTime' || f.control === 'splitDecimal') {
        const parts = f.control === 'splitTime' ? timeParts(value) : decimalParts(value);
        if ('dayType' in parts) await (await unique(input.locator(f.dayType!), '時間タイプ')).fill(parts.dayType);
        await (await unique(input.locator(f.hour!), '時・整数部')).fill(parts.hour);
        await (await unique(input.locator(f.minute!), '分・小数部')).fill('minute' in parts ? parts.minute : parts.fraction);
      }
      else {
        if (value === '') await safeClick(scope.locator(f.clear!));
        else {
          await safeClick(input);
          await safeClick(this.root.locator(f.option!.replaceAll('{code}', value)));
        }
      }
      if (f.commit) {
        if (f.commitField) await this.trackCodeEditor(scope, day, f.commitField);
        await safeClick(scope.locator(f.commit));
        await input.waitFor({ state: 'hidden' });
      } else if (f.control !== 'custom') await input.blur();
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
  async saveDraft(period?: Period, plan?: PlannedDay[]): Promise<void> {
    ensure(this.selectors.verified || this.mode === 'trial', '未確認のセレクタでは下書き保存できません。');
    if (this.selectors.saveMode === 'reopenDraft') {
      ensure(period && plan?.length, '下書き再読取には対象年月と入力予定が必要です。');
      await this.saveAndReopen(period, plan);
      return;
    }
    if (this.selectors.saveMode === 'countAndReturn') {
      await this.saveDraftWithCount();
      return;
    }
    const success = this.root.locator(this.selectors.saveSuccess!);
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
  private async readDraftCount(): Promise<number> {
    const element = await unique(this.root.locator(this.selectors.draftCount!), '下書き件数');
    const text = (await element.innerText()).normalize('NFKC').trim();
    const match = /^下書き\s*[:：]\s*(\d+)\s*件$/.exec(text);
    ensure(match && Number.isSafeInteger(Number(match[1])), '下書き件数を読み取れません。');
    return Number(match[1]);
  }
  private async saveAndReopen(period: Period, plan: PlannedDay[]): Promise<void> {
    const marker = this.root.locator(this.selectors.returnMarker!);
    ensure(await marker.count() === 0 || !(await marker.isVisible()), '既に保存後の画面が表示されています。');
    await safeClick(this.draftButton(), true);
    await marker.waitFor({ state: 'visible' });
    await unique(marker, '保存後画面の目印');
    await this.draftButton().waitFor({ state: 'hidden' });
    ensure(await this.root.locator(this.selectors.rows).count() === 0, '保存後も入力画面が残っています。');
    await new DraftListPage(this.root, this.selectors.draftList!).openMonth(period);
    this.openedCodeValues.clear();
    await this.pageTitle().waitFor({ state: 'visible' });
    await this.draftButton().waitFor({ state: 'visible' });
    await this.assertPeriod(period, async () => false);
    // Read only: saving again could conceal a failed first save.
    for (const day of plan) await this.verify(day);
  }
  private async saveDraftWithCount(): Promise<void> {
    const before = await this.readDraftCount();
    const marker = this.root.locator(this.selectors.returnMarker!);
    ensure(await marker.count() === 0 || !(await marker.isVisible()), '既に保存後の画面が表示されています。');
    await safeClick(this.draftButton(), true);
    const deadline = Date.now() + this.selectors.timeoutMs;
    do {
      try {
        const returned = await marker.count() === 1 && await marker.isVisible();
        const leftEditor = await this.draftButton().count() === 0 && await this.root.locator(this.selectors.rows).count() === 0;
        if (returned && leftEditor && await this.readDraftCount() === before + 1) return;
      } catch {
        // The old document may disappear during navigation. Retry only reads,
        // never the save click; timeout leaves saved=false and the Excel in input.
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    ensure(false, '画面遷移と下書き件数の1件増加を確認できません。既存下書きの更新で件数が変わらない場合も未確認扱いです。Excelは退避しません。');
  }
}
