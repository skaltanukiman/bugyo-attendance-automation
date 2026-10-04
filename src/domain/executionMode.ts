import { ensure } from './attendance.js';

export type ExecutionMode = 'normal' | 'trial' | 'verifyDraft';
export function executionMode(args: readonly string[]): ExecutionMode {
  ensure(args.length === 0 || (args.length === 1 && ['--trial', '--verify-draft'].includes(args[0])), '起動引数が不正です。run.bat、test-run.bat、verify-draft.batを使ってください。');
  return args[0] === '--trial' ? 'trial' : args[0] === '--verify-draft' ? 'verifyDraft' : 'normal';
}
