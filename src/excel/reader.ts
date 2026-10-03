import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import * as XLSX from 'xlsx';
import { ensure } from '../domain/attendance.js';
export interface ExcelReader { extensions: readonly string[]; read(path: string): Promise<XLSX.WorkBook> }
export class SheetJsReader implements ExcelReader {
  readonly extensions = ['.xls', '.xlsx'];
  async read(path: string) {
    return XLSX.read(await readFile(path), { type: 'buffer', cellFormula: true, cellDates: false });
  }
}
export async function readWorkbook(path: string, readers: ExcelReader[] = [new SheetJsReader()]) {
  const reader = readers.find(r => r.extensions.includes(extname(path).toLowerCase()));
  ensure(reader, '対応するExcel Readerがありません。');
  return reader.read(path);
}
