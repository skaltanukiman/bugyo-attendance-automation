import { z } from 'zod';
import type { Fields } from '../domain/attendance.js';
const selector = z.string().min(1);
const field = z.object({ read: selector, readMode: z.enum(['text', 'value']), input: selector,
  control: z.enum(['fill', 'select', 'custom']), option: selector.optional(), clear: selector.optional() });
export const selectorsSchema = z.object({
  verified: z.literal(true),
  frame: selector.nullable(),
  title: selector, period: selector, rows: selector, dateCell: selector,
  editor: selector.nullable(), editButton: selector.nullable(), applyButton: selector.nullable(),
  fields: z.object({ pattern: field, reason: field, start: field, end: field, break: field, worked: field.pick({ read: true, readMode: true }) }),
  saveSuccess: selector, saveSuccessText: selector,
  timeoutMs: z.number().int().min(100).max(120000)
}).superRefine((s, ctx) => {
  if (Boolean(s.editor) !== Boolean(s.editButton) || Boolean(s.editor) !== Boolean(s.applyButton)) ctx.addIssue({ code: 'custom', message: 'ダイアログ編集は editor / editButton / applyButton をすべて設定してください。' });
  for (const k of ['pattern', 'reason', 'start', 'end', 'break'] as const) {
    const f = s.fields[k];
    if (f.control === 'custom' && (!f.option?.includes('{code}') || !f.clear)) ctx.addIssue({ code: 'custom', message: `${k}: customには{code}付きoptionとclearが必要です。` });
  }
});
export type Selectors = z.infer<typeof selectorsSchema>;
export type FieldKey = keyof Fields;
