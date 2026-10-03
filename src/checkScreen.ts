import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import { ensure, UserError } from './domain/attendance.js';
import { loadSettings } from './domain/config.js';
import { Prompt } from './cli/prompt.js';
import { daysInMonth } from './utils/date.js';
import { inspectionSelectorsSchema } from './browser/selectors.js';
import { findAttendancePage } from './browser/findAttendancePage.js';
import { launchEdge, connectEdge, disconnect } from './browser/edgeLauncher.js';
import { inspectScreen } from './services/screenInspection.js';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
let browser: Browser | undefined, prompt: Prompt | undefined;
let locked = false, launched = false;
let stage = '確認設定';
const lockPath = resolve('.runtime/run.lock');
try {
  console.log('画面の読取確認専用です。自動入力・保存・申請・Excel退避は行いません。');
  const settings = await loadSettings('config/settings.json');
  const parsed = inspectionSelectorsSchema.safeParse(JSON.parse(await readFile(settings.browser.selectorsFile, 'utf8')));
  ensure(parsed.success, '読取確認に必要なセレクタ設定が不足しています。');
  // verified remains false, even if inspection succeeds. No setting files are written.
  const selectors = { ...parsed.data, verified: false };
  await mkdir('.runtime', { recursive: true });
  try { const lock = await open(lockPath, 'wx'); locked = true; try { await lock.writeFile(String(process.pid)); } finally { await lock.close(); } }
  catch { throw new UserError('別の処理が実行中、または前回のロックが残っています。.runtime/run.lockを確認してください。'); }
  prompt = new Prompt();
  const period = await prompt.retry(async () => {
    const value = (await prompt!.question('対象年月（西暦のYYYYMM・6桁） > ')).trim();
    ensure(/^\d{6}$/.test(value), '対象年月を6桁で入力してください。');
    const result = { year: Number(value.slice(0, 4)), month: Number(value.slice(4)) };
    ensure(result.year >= 1900 && result.month >= 1 && result.month <= 12, '対象年月が不正です。');
    return result;
  });
  const sampleDay = await prompt.retry(async () => {
    const value = (await prompt!.question('先ほど手動入力を確認した日（1〜末日） > ')).trim();
    ensure(/^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= daysInMonth(period), '対象月に存在する日を入力してください。');
    return Number(value);
  });
  stage = '専用Edge起動';
  await launchEdge(settings.browser); launched = true;
  await prompt.question('起動した専用Edgeで手動ログインし、対象月の「勤務実績申請」入力画面を開いてください。\n入力欄の編集を終えてから、このコンソールに戻りEnterを押してください。');
  stage = '接続・対象画面の識別';
  browser = await connectEdge(settings.browser.remoteDebuggingPort);
  const page = await findAttendancePage(browser, selectors, 'normal', console.log);
  stage = '全日付・各項目の読取';
  const result = await inspectScreen(page, period, sampleDay);
  console.log(`確認成功: 対象年月・全${result.days}日・各日の6項目を読み取れました。`);
  console.log(`確認日 ${sampleDay}日: 勤務体系=${result.sample.pattern || '空欄'} / 事由=${result.sample.reason || '空欄'} / 出勤=${result.sample.start || '空欄'} / 退出=${result.sample.end || '空欄'} / 休憩=${result.sample.break || '空欄'} / 実働=${result.sample.worked || '空欄'}`);
  console.log('表示された確認日の値が画面と一致するか確認してください。読取成功だけでは入力・保存の動作確認は完了しません。');
} catch (error) {
  process.exitCode = 1;
  console.log(`ERROR: ${stage}\n${error instanceof UserError ? error.message : '確認処理に失敗しました。設定と画面状態を確認してください。'}`);
} finally {
  if (browser) { try { await disconnect(browser); } catch { console.log('接続解除に失敗しました。専用Edgeは手動で閉じてください。'); } }
  prompt?.close();
  if (locked) await unlink(lockPath).catch(() => console.log('実行ロックの削除に失敗しました。'));
  if (launched) console.log('専用Edgeは開いたままです。結果はコンソールのみで、勤怠値をログファイルに保存していません。');
}
