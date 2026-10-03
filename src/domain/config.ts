import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { timestamp } from '../utils/date.js';
const code = z.string().regex(/^\d+$/);
export const settingsSchema = z.object({
  attendance: z.object({ workPatternCode: code, remoteReasonCode: code, officeReasonCode: code.nullable(), paidLeaveReasonCode: code }),
  files: z.object({ inputDirectory: z.string().min(1), backupDirectory: z.string().min(1), supportedExtensions: z.array(z.enum(['.xls', '.xlsx'])).min(1), backupTimestampFormat: z.string().min(1) }),
  browser: z.object({ remoteDebuggingPort: z.number().int().min(1024).max(65535), userDataDirectory: z.string().min(1), executablePath: z.string().nullable(), selectorsFile: z.string().min(1) })
});
export type Settings = z.infer<typeof settingsSchema>;
export async function loadSettings(path: string): Promise<Settings> {
  const settings = settingsSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  timestamp(new Date(), settings.files.backupTimestampFormat);
  return settings;
}
