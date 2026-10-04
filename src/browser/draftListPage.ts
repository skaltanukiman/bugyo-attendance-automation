import type { Page, FrameLocator, Locator } from 'playwright';
import { ensure, type Period } from '../domain/attendance.js';
import { isWholeMonthRange } from '../utils/date.js';
import type { Selectors } from './selectors.js';
import { safeClick, unique, waitUntil } from './interactions.js';

export class DraftListPage {
  constructor(readonly root: Page | FrameLocator, readonly config: NonNullable<Selectors['draftList']>, readonly timeoutMs = 10000, readonly busy?: string, readonly stableMs = 0) {}
  private async ready(element: Locator, label: string): Promise<void> {
    let readySince: number | undefined;
    await waitUntil(async () => {
      try {
        const ready = (!this.busy || await this.root.locator(this.busy).filter({ visible: true }).count() === 0) &&
          await element.count() === 1 && await element.isVisible();
        if (!ready) { readySince = undefined; return false; }
        readySince ??= Date.now();
        return Date.now() - readySince >= this.stableMs;
      } catch { readySince = undefined; return false; }
    }, label, this.timeoutMs);
  }
  async openMonth(period: Period): Promise<void> {
    const entry = this.root.locator(this.config.entry).filter({ visible: true });
    await this.ready(entry, '下書き一覧の入口・読込終了');
    await safeClick(entry, 'draftList', '下書き一覧の入口');
    await this.openListedMonth(period);
  }
  async openListedMonth(period: Period): Promise<void> {
    const titleLocator = this.root.locator(this.config.title).filter({ visible: true });
    await this.ready(titleLocator, '下書き一覧タイトル・読込終了');
    const loaded = this.root.locator(this.config.loaded).filter({ visible: true });
    await this.ready(loaded, '下書き一覧の読込完了表示・読込終了');
    await unique(loaded, '下書き一覧の読込完了表示');
    const title = await unique(titleLocator, '下書き一覧タイトル');
    ensure((await title.innerText()).trim() === '申請状況', '下書き一覧画面を確認できません。');
    const matches: Locator[] = [];
    for (const row of await this.root.locator(this.config.rows).all()) {
      const status = row.locator(this.config.status), name = row.locator(this.config.name), range = row.locator(this.config.period);
      ensure(await status.count() === 1 && await name.count() === 1 && await range.count() === 1, '下書き一覧の行を解釈できません。');
      if ((await status.innerText()).trim() !== '下書き' || (await name.innerText()).trim() !== '勤務実績申請') continue;
      if (isWholeMonthRange(await range.innerText(), period)) matches.push(row);
    }
    ensure(matches.length === 1, '対象年月の勤務実績の下書きを一意に特定できません。Excelは退避しません。');
    const editorButton = this.root.locator(this.config.openEditor).filter({ visible: true });
    ensure(await editorButton.count() === 0, '前の下書き詳細が残っています。');
    const link = matches[0].locator(this.config.open);
    await this.ready(link, '対象下書きの詳細リンク・読込終了');
    await safeClick(link, 'draftDetails', '対象下書きの詳細リンク');
    await this.ready(editorButton, '下書きの申請書入力ボタン・読込終了');
    await safeClick(editorButton, 'draftEditor', '下書きの申請書入力ボタン');
  }
}
