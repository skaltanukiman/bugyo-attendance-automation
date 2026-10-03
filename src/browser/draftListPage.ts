import type { Page, FrameLocator, Locator } from 'playwright';
import { ensure, type Period } from '../domain/attendance.js';
import { isWholeMonthRange } from '../utils/date.js';
import type { Selectors } from './selectors.js';
import { safeClick, unique } from './interactions.js';

export class DraftListPage {
  constructor(readonly root: Page | FrameLocator, readonly config: NonNullable<Selectors['draftList']>) {}
  async openMonth(period: Period): Promise<void> {
    await safeClick(this.root.locator(this.config.entry));
    const titleLocator = this.root.locator(this.config.title).filter({ visible: true });
    await titleLocator.waitFor({ state: 'visible' });
    await this.root.locator(this.config.loaded).waitFor({ state: 'visible' });
    await unique(this.root.locator(this.config.loaded), '下書き一覧の読込完了表示');
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
    const editorButton = this.root.locator(this.config.openEditor);
    ensure(await editorButton.count() === 0 || (await editorButton.count() === 1 && !await editorButton.isVisible()), '前の下書き詳細が残っています。');
    await safeClick(matches[0].locator(this.config.open), 'draftDetails');
    await editorButton.waitFor({ state: 'visible' });
    await safeClick(editorButton, 'draftEditor');
  }
}
