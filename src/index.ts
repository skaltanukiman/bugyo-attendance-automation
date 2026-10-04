import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import { loadSettings } from './domain/config.js';
import { ensure, UserError } from './domain/attendance.js';
import { executionMode } from './domain/executionMode.js';
import { readWorkbook } from './excel/reader.js';
import { parseWorkbook } from './excel/parser.js';
import { parseDays, periodFromFilename } from './utils/date.js';
import { discover } from './utils/file.js';
import { createLogger } from './utils/logger.js';
import { Prompt } from './cli/prompt.js';
import { summary, leaveWarning } from './cli/summary.js';
import { buildPlan } from './services/validationService.js';
import { enterAndSave, verifySavedDraft, initialState } from './services/attendanceService.js';
import { backupFile, fingerprint } from './services/backupService.js';
import { selectorsForRun } from './browser/selectors.js';
import { findAttendancePage } from './browser/findAttendancePage.js';
import { launchEdge, connectEdge, disconnect } from './browser/edgeLauncher.js';

export async function main(): Promise<void> {
  process.chdir(fileURLToPath(new URL('../', import.meta.url)));
  const state = initialState();
  let log: (message: string) => void = console.log;
  let prompt: Prompt | undefined, browser: Browser | undefined;
  let locked = false, edgeLaunched = false, paidUnset = false, paidCode = '', file = '';
  const lockPath = resolve('.runtime/run.lock');
  try {
    const mode = executionMode(process.argv.slice(2));
    await mkdir('.runtime', { recursive: true });
    try { const lock = await open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); await lock.close(); locked = true; }
    catch { throw new UserError('別の処理が実行中、または前回のロックが残っています。.runtime/run.lockを確認してください。'); }
    log = createLogger('logs');
    if (mode === 'verifyDraft') log('保存済み下書きの再確認: 対象下書きを開き、Excelと照合して成功時のみ退避します。入力・再保存・申請は行いません。');
    state.stage = '設定読み込み';
    const settings = await loadSettings('config/settings.json');
    prompt = new Prompt();
    state.stage = 'Excel検出・解析';
    file = await prompt.choose(await discover(settings.files.inputDirectory, settings.files.supportedExtensions));
    const hash = await fingerprint(file);
    const period = periodFromFilename(file);
    const records = parseWorkbook(await readWorkbook(file), period);
    ensure(await fingerprint(file) === hash, '解析中にExcelが変更されました。');
    log(`Excel解析完了: ${file}`);
    const office = await prompt.retry(async () => {
      const days = parseDays(await prompt!.question('出社日（例: 3,18,25／なしはEnter） > '), period);
      buildPlan(records, days, [], settings.attendance);
      return days;
    });
    const paid = await prompt.retry(async () => {
      const days = parseDays(await prompt!.question('有休日（任意・例: 7、29、30／手動入力する場合はEnter） > '), period);
      buildPlan(records, office, days, settings.attendance);
      return days;
    });
    paidUnset = paid.length === 0; paidCode = settings.attendance.paidLeaveReasonCode;
    const plan = buildPlan(records, office, paid, settings.attendance);
    log(summary(file, period, plan, settings.attendance));
    for (const r of records.filter(r => !r.hasWork && !paid.includes(r.day))) log(`${r.date} 非対象 SKIP（休暇種別は判定しません）`);
    if (paidUnset) log(leaveWarning(paidCode));
    ensure(plan.length > 0, '入力対象日がありません。');
    if (!await prompt.confirm(mode === 'verifyDraft' ? 'この内容で保存済み下書きの照合・Excel退避を開始しますか？' : 'この内容でブラウザを起動しますか？', true)) { log('キャンセルしました。画面とExcelは変更していません。'); return; }
    state.stage = 'セレクタ設定確認';
    const selectors = selectorsForRun(JSON.parse(await readFile(settings.browser.selectorsFile, 'utf8')), mode);
    state.stage = 'Edge起動';
    if (mode === 'verifyDraft') {
      try { browser = await connectEdge(settings.browser.remoteDebuggingPort, 2000); log('起動済みの専用Edgeに接続しました。'); }
      catch { await launchEdge(settings.browser); }
      edgeLaunched = true;
      await prompt.question('専用Edgeで手動ログインし、下書き件数・「申請期間」・OKが表示される画面を開いてください。\n「下書き:N件」は自動で開きます。準備が完了したらこのコンソールへ戻りEnterを押してください。');
    } else {
      await launchEdge(settings.browser); edgeLaunched = true;
      await prompt.question('Microsoft Edgeを起動しました。\n1. 手動で奉行クラウドへログインしてください。\n2. 「勤務実績申請」画面で対象月を表示してください。\n準備が完了したら、このコンソールへ戻りEnterを押してください。');
    }
    state.stage = 'Edge接続・対象タブ確認';
    browser ??= await connectEdge(settings.browser.remoteDebuggingPort);
    const page = await findAttendancePage(browser, selectors, mode, log);
    let yearConfirmed = false;
    if (mode === 'verifyDraft') {
      await verifySavedDraft(page, period, plan, state, log);
    } else await enterAndSave(page, period, plan, settings.attendance.remoteReasonCode, state, log, async () => {
      if (!yearConfirmed) yearConfirmed = await prompt!.confirm(`画面から年を取得できません。表示は本当に${period.year}年${period.month}月ですか？`);
      return yearConfirmed;
    });
    state.stage = 'Playwright切断';
    await disconnect(browser); browser = undefined;
    state.stage = 'Excelバックアップ';
    try {
      const target = await backupFile(file, settings.files.inputDirectory, settings.files.backupDirectory, settings.files.backupTimestampFormat, hash, state);
      log(`Excelバックアップ完了: ${target}`);
    } catch {
      log(`WARNING: 下書き保存は正常完了しましたがExcelの退避に失敗しました。${file} はinputに残っています。手動でバックアップしてください。`);
      process.exitCode = 2;
    }
    log(summary(file, period, plan, settings.attendance));
    log(mode === 'verifyDraft' ? '保存済み下書きの照合が完了しました。入力・再保存・申請は実行していません。' : '勤務実績入力・検証・下書き保存が完了しました。ブラウザを確認し、問題がなければ利用者自身が「申請」してください。');
  } catch (error) {
    process.exitCode = 1;
    const detail = error instanceof UserError ? error.message : '処理に失敗しました。設定・ファイル・画面状態を確認してください（認証情報保護のため生のエラーは記録しません）。';
    log(`ERROR: ${state.stage}\n${detail}\n入力: ${state.inputStarted ? '開始済み（一部入力の可能性あり）' : '未開始'}\n検証: ${state.verified ? '成功' : '未完了'}\n下書き保存: ${state.saved ? '成功確認済み' : state.saveAttempted ? '実行済み・成功未確認。画面を確認してください' : '未実施'}\nExcel退避: ${state.backedUp ? '完了' : '未実施'}\n入力ファイル: ${file || '未選択'}`);
  } finally {
    if (browser) { try { await disconnect(browser); } catch { log('Playwright切断に失敗しました。Edgeは自動終了しません。'); } }
    if (edgeLaunched) log('Edgeは開いたままです。画面を確認してください。最終申請は自動実行していません。');
    if (paidUnset && (state.inputStarted || state.saved)) log(leaveWarning(paidCode));
    prompt?.close();
    if (locked) await unlink(lockPath).catch(() => console.log('実行ロックの削除に失敗しました。'));
  }
}
await main();
