import { z } from 'zod';
import type { Fields } from '../domain/attendance.js';
import { ensure } from '../domain/attendance.js';
import type { ExecutionMode } from '../domain/executionMode.js';
const selector = z.string().min(1);
const readable = z.object({ read: selector, readMode: z.enum(['text', 'value', 'attribute']),
  readAttribute: selector.optional(), emptyAttributes: z.array(selector).optional() });
const field = readable.extend({ input: selector,
  control: z.enum(['fill', 'select', 'custom', 'splitTime', 'splitDecimal']), option: selector.optional(), clear: selector.optional(),
  activate: selector.optional(), commit: selector.optional(),
  commitField: z.enum(['pattern', 'reason']).optional(),
  hour: selector.optional(), minute: selector.optional(), dayType: selector.optional() });
const selectorsDefinition = z.object({
  verified: z.boolean(),
  frame: selector.nullable(),
  title: selector, period: selector.nullable(), rows: selector, dateCell: selector,
  periodSource: z.enum(['display', 'rowDates']).optional(),
  dateEvidence: z.object({ selector, attribute: selector }).optional(),
  editor: selector.nullable(), editButton: selector.nullable(), applyButton: selector.nullable(),
  fields: z.object({ pattern: field, reason: field, start: field, end: field, break: field, worked: readable }),
  saveMode: z.enum(['message', 'countAndReturn', 'reopenDraft']).optional(),
  saveSuccess: selector.nullable(), saveSuccessText: selector.nullable(),
  draftCount: selector.nullable().optional(), returnMarker: selector.nullable().optional(),
  draftList: z.object({ entry: selector, title: selector, loaded: selector, rows: selector,
    status: selector, name: selector, period: selector, open: selector, openEditor: selector }).nullable().optional(),
  timeoutMs: z.number().int().min(100).max(120000)
});
function validateSelectors(s: z.infer<typeof selectorsDefinition>, ctx: z.RefinementCtx) {
  const saveConfigured = s.saveMode === 'reopenDraft' ? s.returnMarker && s.draftList
    : s.saveMode === 'countAndReturn' ? s.draftCount && s.returnMarker : s.saveSuccess && s.saveSuccessText;
  if (!saveConfigured) ctx.addIssue({ code: 'custom', message: '保存成功の確認方法を設定してください。' });
  if (s.periodSource === 'rowDates' ? !s.dateEvidence : !s.period) ctx.addIssue({ code: 'custom', message: '対象年月の取得元を設定してください。' });
  if (Boolean(s.editor) !== Boolean(s.editButton) || Boolean(s.editor) !== Boolean(s.applyButton)) ctx.addIssue({ code: 'custom', message: 'ダイアログ編集は editor / editButton / applyButton をすべて設定してください。' });
  for (const k of ['pattern', 'reason', 'start', 'end', 'break'] as const) {
    const f = s.fields[k];
    if (f.control === 'custom' && (!f.option?.includes('{code}') || !f.clear)) ctx.addIssue({ code: 'custom', message: `${k}: customには{code}付きoptionとclearが必要です。` });
    if (Boolean(f.activate) !== Boolean(f.commit)) ctx.addIssue({ code: 'custom', message: `${k}: セル編集はactivateとcommitを両方設定してください。` });
    if (f.commitField && (!f.commit || f.commit !== s.fields[f.commitField].activate || !['fill', 'select'].includes(s.fields[f.commitField].control))) ctx.addIssue({ code: 'custom', message: `${k}: 確定先のコード入力欄とセレクタが一致しません。` });
    if (f.control === 'splitTime' || f.control === 'splitDecimal') {
      if (!f.activate || !f.hour || !f.minute || (f.control === 'splitTime' && !f.dayType)) ctx.addIssue({ code: 'custom', message: `${k}: 分割入力のセレクタが不足しています。` });
      if ((f.control === 'splitTime' && k !== 'start' && k !== 'end') || (f.control === 'splitDecimal' && k !== 'break')) ctx.addIssue({ code: 'custom', message: `${k}: 分割入力方式が項目に適合しません。` });
    }
  }
  for (const [k, f] of Object.entries(s.fields)) if (f.readMode === 'attribute' && !f.readAttribute) ctx.addIssue({ code: 'custom', message: `${k}: readAttributeが必要です。` });
}
export const selectorsSchema = selectorsDefinition.extend({ verified: z.literal(true) }).superRefine(validateSelectors);
export const inspectionSelectorsSchema = selectorsDefinition.superRefine(validateSelectors);
export function selectorsForRun(raw: unknown, mode: ExecutionMode): InspectionSelectors {
  const parsed = (mode === 'trial' ? inspectionSelectorsSchema : selectorsSchema).safeParse(raw);
  ensure(parsed.success, '実DOMのセレクタが未設定、未確認、または設定が不正です。入力は開始していません。');
  return parsed.data;
}
export type Selectors = z.infer<typeof selectorsSchema>;
export type InspectionSelectors = z.infer<typeof inspectionSelectorsSchema>;
export type FieldKey = keyof Fields;
export type EditableField = Selectors['fields']['start'];
