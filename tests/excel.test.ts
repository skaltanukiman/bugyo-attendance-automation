import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../src/excel/parser.js';
import { readWorkbook } from '../src/excel/reader.js';
import { workbook, period } from './helpers.js';
test('時・分列から実績を正規化し、空欄から休暇を推測しない', () => {
  const rows = parseWorkbook(workbook(), period);
  assert.equal(rows.length, 30);
  assert.deepEqual(rows[0], { day: 1, date: '2026-09-01', hasWork: true, startTime: '09:00', endTime: '17:30', breakHours: 1, workedHours: 7.5 });
  assert.deepEqual(rows[1], { day: 2, date: '2026-09-02', hasWork: false });
});
test('実際のxls/xlsxバイナリをReader経由で読める', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bugyo-reader-'));
  try {
    for (const extension of ['xls', 'xlsx'] as const) {
      const file = join(dir, `202609_test.${extension}`);
      await writeFile(file, XLSX.write(workbook(), { type: 'buffer', bookType: extension === 'xls' ? 'biff8' : 'xlsx' }));
      assert.equal(parseWorkbook(await readWorkbook(file), period)[0].workedHours, 7.5);
    }
    await assert.rejects(() => readWorkbook(join(dir, 'x.csv')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('月違い・不正時刻・欠落・合計不一致・数式エラーを拒否', () => {
  assert.throws(() => parseWorkbook(workbook(), { year: 2026, month: 8 }));
  for (const [address, value] of [['E10', 60], ['L42', 8], ['L10', 6], ['C10', 1], ['B8', '別様式']] as const) {
    const book = workbook(); book.Sheets.明細[address].v = value;
    assert.throws(() => parseWorkbook(book, period));
  }
  const missing = workbook(); delete missing.Sheets.明細.E10; assert.throws(() => parseWorkbook(missing, period));
  const error = workbook(); error.Sheets.明細.L10 = { t: 'e', v: 15 }; assert.throws(() => parseWorkbook(error, period));
});
test('28/29/30/31日月を検証する', () => {
  for (const [year, month, days] of [[2026, 2, 28], [2028, 2, 29], [2026, 9, 30], [2026, 8, 31]]) assert.equal(parseWorkbook(workbook(month, year), { year, month }).length, days);
});
