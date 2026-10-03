import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
export async function discover(directory: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter(e => e.isFile() && !e.name.startsWith('~$') && extensions.includes(extname(e.name).toLowerCase()) && /^\d{6}_.+/.test(e.name)).map(e => join(directory, e.name)).sort();
}
