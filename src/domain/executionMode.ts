import { ensure } from './attendance.js';

export type ExecutionMode = 'normal' | 'trial';
export function executionMode(args: readonly string[]): ExecutionMode {
  ensure(args.length === 0 || (args.length === 1 && args[0] === '--trial'), '起動引数が不正です。通常実行はrun.bat、通しテストはtest-run.batを使ってください。');
  return args.length === 1 ? 'trial' : 'normal';
}
