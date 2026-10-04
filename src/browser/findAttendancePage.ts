import type { Browser } from 'playwright';
import { ensure } from '../domain/attendance.js';
import type { ExecutionMode } from '../domain/executionMode.js';
import { AttendancePage } from './attendancePage.js';
import type { InspectionSelectors } from './selectors.js';

export async function findAttendancePage(browser: Browser, selectors: InspectionSelectors, mode: ExecutionMode, log: (message: string) => void): Promise<AttendancePage> {
  const candidates: AttendancePage[] = [];
  let index = 0;
  for (const context of browser.contexts()) for (const tab of context.pages()) {
    index++;
    const port = new AttendancePage(tab, selectors, mode);
    try {
      const counts = await port.identificationCounts();
      // Counts only: never log page URLs, frame URLs, HTML or tenant/user names.
      log(`画面識別: タブ${index} / iframe数=${tab.frames().length - 1} / タイトル=${counts.titles}（表示中${counts.visibleTitles}） / 下書き保存=${counts.draftButtons} / 日付行=${counts.rows}`);
      if (mode === 'verifyDraft' ? await port.matchesSavedReturn() : await port.matches()) candidates.push(port);
    } catch {
      log(`画面識別: タブ${index}の検出に失敗しました。読み込み状態とiframe設定を確認してください。`);
    }
  }
  const target = mode === 'verifyDraft' ? '申請期間画面' : '入力画面';
  ensure(candidates.length > 0, `${target}の候補が0件です。専用Edgeの${target}を開き、上の検出件数とiframe設定を確認してください。`);
  ensure(candidates.length === 1, `${target}の候補が${candidates.length}件あります。対象画面を1タブだけにしてください。`);
  return candidates[0];
}
