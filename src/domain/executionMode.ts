import { ensure } from './attendance.js';

export type ExecutionMode = 'normal' | 'verifyDraft';
export function executionMode(args: readonly string[]): ExecutionMode {
  ensure(args.length === 0 || (args.length === 1 && args[0] === '--verify-draft'), '起動引数が不正です。run.batまたはverify-draft.batを使ってください。');
  return args[0] === '--verify-draft' ? 'verifyDraft' : 'normal';
}
