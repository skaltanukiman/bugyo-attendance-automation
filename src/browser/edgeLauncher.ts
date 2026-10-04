import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, type Browser } from 'playwright';
import type { Settings } from '../domain/config.js';
import { ensure, UserError } from '../domain/attendance.js';

export async function launchEdge(settings: Settings['browser']): Promise<void> {
  const candidates = settings.executablePath ? [settings.executablePath] : [
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft/Edge/Application/msedge.exe')
  ];
  let executable: string | undefined;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch { /* next */ } }
  ensure(executable, 'Microsoft Edgeが見つかりません。browser.executablePathを設定してください。');
  await new Promise<void>((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () => reject(new UserError('デバッグポートが使用中、または利用できません。専用Edgeを手動で閉じるか、ポート設定を確認してください。')));
    server.listen(settings.remoteDebuggingPort, '127.0.0.1', () => server.close(() => resolvePort()));
  });
  const profile = resolve(settings.userDataDirectory);
  await mkdir(profile, { recursive: true });
  const child = spawn(executable, [`--remote-debugging-port=${settings.remoteDebuggingPort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--new-window', 'about:blank'], { detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise<void>((ready, reject) => { child.once('spawn', ready); child.once('error', reject); });
  child.unref();
}
export async function connectEdge(port: number, timeout = 15000): Promise<Browser> {
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout });
}
export async function disconnect(browser: Browser): Promise<void> {
  // For connectOverCDP, Browser.close detaches the Playwright connection; it does not
  // send Browser.close to the independently spawned Edge. Covered by a CDP lifecycle test.
  await browser.close();
}
