import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDays, periodFromFilename, parseScreenPeriod, timestamp } from '../src/utils/date.js';
import { buildPlan, conflicts, normalized } from '../src/services/validationService.js';
import { codes, period, record } from './helpers.js';
test('ファイル名の名称・拡張子に依存せず年月を取得する', () => {
  for (const name of ['202610_作業実績報告書.xls', '202610_別名称.xlsx']) assert.deepEqual(periodFromFilename(name), { year: 2026, month: 10 });
  for (const name of ['202613_x.xls', '202600_x.xls', 'x202610_x.xls', '202610.xls']) assert.throws(() => periodFromFilename(name));
});
test('出社日を重複排除・昇順、読点に対応し範囲を検証する', () => {
  assert.deepEqual(parseDays('25,3、18,3', period), [3, 18, 25]);
  assert.deepEqual(parseDays('', period), []);
  for (const text of ['35', '0', '31', '1,', '1.5', '-1', 'abc']) assert.throws(() => parseDays(text, period));
  assert.deepEqual(parseDays('29', { year: 2028, month: 2 }), [29]);
  assert.throws(() => parseDays('29', { year: 2026, month: 2 }));
});
test('和暦・西暦・月のみを厳密に解析する', () => {
  assert.deepEqual(parseScreenPeriod('令和 8年 9月'), period);
  assert.deepEqual(parseScreenPeriod('2026年9月'), period);
  assert.deepEqual(parseScreenPeriod('令和元年5月'), { year: 2019, month: 5 });
  assert.deepEqual(parseScreenPeriod('9月'), { year: undefined, month: 9 });
  for (const value of ['2026年13月', '9月 10月', '本日2026年9月', '2026/09']) assert.throws(() => parseScreenPeriod(value));
});
test('在宅・出社空欄・将来の事由コード・明示有休・非対象日', () => {
  const rows = [record(1), record(2), record(3, false), record(4, false)];
  const plan = buildPlan(rows, [2], [3], codes);
  assert.deepEqual(plan.map(d => d.expected.reason), ['007', '', '040']);
  assert.equal(plan[2].expected.start, '');
  assert.equal(plan.length, 3);
  assert.equal(buildPlan(rows, [2], [], { ...codes, workPatternCode: '200', officeReasonCode: '006' })[1].expected.reason, '006');
  assert.throws(() => buildPlan(rows, [3], [], codes));
  assert.throws(() => buildPlan(rows, [1], [1], codes));
  assert.throws(() => buildPlan(rows, [], [1], codes));
});
test('既存値競合では勤務体系と明示出社の旧在宅事由だけ変更を許す', () => {
  const day = buildPlan([record(1)], [1], [], codes)[0];
  assert.deepEqual(conflicts({ ...day.expected, pattern: '200', reason: '007' }, day, '007'), []);
  assert.equal(conflicts({ ...day.expected, start: '10:00', reason: '040' }, day, '007').length, 2);
  assert.deepEqual(normalized({ ...day.expected, pattern: '205 エンジニア', start: '9:00' }), day.expected);
});
test('バックアップ日時はAsia/Tokyoで設定可能、パス文字列を拒否', () => {
  assert.equal(timestamp(new Date('2026-10-03T15:36:42Z'), 'yyyyMMddHHmmss'), '20261004003642');
  assert.equal(timestamp(new Date('2026-10-03T15:36:42Z'), 'yyyy-MM-dd_HH-mm-ss'), '2026-10-04_00-36-42');
  assert.throws(() => timestamp(new Date(), '../yyyy'));
});
