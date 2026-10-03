import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from '../src/utils/file.js';
import { leaveWarning } from '../src/cli/summary.js';
test('対象拡張子・命名規則で複数候補を返し、ロックファイルとディレクトリを除外', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bugyo-files-'));
  try {
    for (const name of ['202608_a.xls', '202609_b.xlsx', '~$202609_b.xlsx', '202609_note.txt', 'unrelated.xls']) await writeFile(join(dir, name), '');
    await mkdir(join(dir, '202610_folder.xls'));
    assert.deepEqual((await discover(dir, ['.xls', '.xlsx'])).map(p => basename(p)), ['202608_a.xls', '202609_b.xlsx']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('有休未指定の終了警告は設定された事由コードと手動入力を明示', () => {
  assert.match(leaveWarning('045'), /有休は自動入力していません/);
  assert.match(leaveWarning('045'), /045 有休/);
  assert.match(leaveWarning('045'), /手動入力/);
});
