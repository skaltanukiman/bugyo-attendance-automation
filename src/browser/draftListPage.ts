import type { Page, FrameLocator, Locator } from 'playwright';
import { ensure, type Period } from '../domain/attendance.js';
import { isWholeMonthRange } from '../utils/date.js';
import type { Selectors } from './selectors.js';
import { safeClick, unique, waitVisible } from './interactions.js';

export class DraftListPage {
  constructor(readonly root: Page | FrameLocator, readonly config: NonNullable<Selectors['draftList']>) {}
  async openMonth(period: Period): Promise<void> {
    const entry = this.root.locator(this.config.entry).filter({ visible: true });
    await waitVisible(entry, '下書き一覧の入口');
    await safeClick(entry, 'draftList', '下書き一覧の入口');
    const titleLocator = this.root.locator(this.config.title).filter({ visible: true });
    await waitVisible(titleLocator, '下書き一覧タイトル');
    const loaded = this.root.locator(this.config.loaded).filter({ visible: true });
    await waitVisible(loaded, '下書き一覧の読込完了表示');
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
    await safeClick(matches[0].locator(this.config.open), 'draftDetails', '対象下書きの詳細リンク');
    await waitVisible(editorButton, '下書きの申請書入力ボタン');
    await safeClick(editorButton, 'draftEditor', '下書きの申請書入力ボタン');
  }
}
