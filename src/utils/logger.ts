import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export function createLogger(directory: string): (message: string) => void {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.log`);
  return message => {
    console.log(message);
    // Only application-generated attendance messages enter the logger.
    // Raw browser errors, page HTML, URLs, cookies and authentication data are excluded.
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf8');
  };
}
