import { mkdir, rename, readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve, join } from 'node:path';
import { ensure } from '../domain/attendance.js';
import { timestamp } from '../utils/date.js';
import type { RunState } from './attendanceService.js';
export const fingerprint = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
export async function backupFile(source: string, input: string, destination: string, format: string, expectedHash: string, state: RunState, now = new Date()): Promise<string> {
  ensure(state.saved && state.verified, '保存成功・入力検証完了前のExcel退避は禁止されています。');
  const full = resolve(source);
  ensure(dirname(full) === resolve(input) && !(await lstat(full)).isSymbolicLink(), 'バックアップ対象がinput直下の通常ファイルではありません。');
  ensure(await fingerprint(full) === expectedHash, '処理中にExcelが変更されました。自動退避しません。');
  await mkdir(resolve(destination), { recursive: true });
  const folder = join(resolve(destination), timestamp(now, format));
  // Exclusive directory creation prevents overwrite on timestamp collisions.
  await mkdir(folder);
  const target = join(folder, basename(full));
  await rename(full, target);
  state.backedUp = true;
  return target;
}
