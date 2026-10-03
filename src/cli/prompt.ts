import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { basename } from 'node:path';
import { ensure, UserError } from '../domain/attendance.js';
export class Prompt {
  private readonly rl = createInterface({ input: stdin, output: stdout });
  question(text: string) { return this.rl.question(text); }
  close() { this.rl.close(); }
  async confirm(text: string, defaultYes = false): Promise<boolean> {
    for (;;) {
      const answer = (await this.question(`${text} ${defaultYes ? '[Y/n]' : '[y/N]'}: `)).trim().toLowerCase();
      if (!answer) return defaultYes;
      if (answer === 'y' || answer === 'yes') return true;
      if (answer === 'n' || answer === 'no') return false;
      console.log('y または n を入力してください。');
    }
  }
  async retry<T>(action: () => Promise<T>): Promise<T> {
    for (;;) {
      try { return await action(); } catch (error) {
        if (!(error instanceof UserError)) throw error;
        console.log(`ERROR: ${error.message}`);
      }
    }
  }
  async choose(files: string[]): Promise<string> {
    ensure(files.length, 'input/に対象Excelがありません。');
    if (files.length === 1) return files[0];
    console.log('対象ファイルが複数あります。');
    files.forEach((file, index) => console.log(`[${index + 1}] ${basename(file)}`));
    return this.retry(async () => {
      const text = (await this.question('使用するファイル番号 > ')).trim();
      ensure(/^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= files.length, '一覧の番号を入力してください。');
      return files[Number(text) - 1];
    });
  }
}
