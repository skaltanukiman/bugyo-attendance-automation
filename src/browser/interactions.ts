import type { Locator } from 'playwright';
import { ensure } from '../domain/attendance.js';

export async function unique(locator: Locator, label: string): Promise<Locator> {
  ensure(await locator.count() === 1 && await locator.isVisible(), `${label}: 要素がない、複数ある、または非表示です。`);
  return locator;
}
// All clicks pass this guard. Application submission is never an allowed action.
export async function safeClick(locator: Locator, action: boolean | 'draftDetails' | 'draftEditor' = false): Promise<void> {
  await unique(locator, '操作対象');
  const names = await Promise.all([locator.getAttribute('aria-label'), locator.getAttribute('title'), locator.getAttribute('value'), locator.textContent()]);
  if (action === 'draftDetails' || action === 'draftEditor') {
    const expected = action === 'draftDetails' ? '勤務実績申請' : '申請書入力';
    const labels = names.map(n => n?.trim()).filter(Boolean);
    ensure(labels.length > 0 && labels.every(n => n === expected), '下書き確認操作の名称が一致しません。');
    const valid = await locator.evaluate((el, purpose) => purpose === 'draftDetails'
      ? el instanceof HTMLAnchorElement && ['', '#'].includes(el.getAttribute('href') ?? '') && ['', '_self'].includes(el.target)
      : el instanceof HTMLButtonElement && el.type === 'button', action);
    ensure(valid, '下書き確認に対応するリンクまたは非送信ボタンではありません。');
  } else {
    ensure(!names.some(n => n?.includes('申請')), '申請操作は禁止されています。');
    if (action) ensure(names.some(n => n?.trim() === '下書き保存'), '下書き保存ボタンの名称が一致しません。');
  }
  if (!action) {
    const submits = await locator.evaluate(el => (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.type === 'submit');
    ensure(!submits, '行編集にsubmitボタンは使用できません。');
  }
  await locator.click();
}
