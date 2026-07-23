import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractXlsx, readExcel, writeExcel, editExcel } from './xlsx';

let tmpDir: string;
const file = (name: string) => path.join(tmpDir, name);

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeExcel → readExcel roundtrip (real xlsx files)', () => {
  it('creates a workbook and reads it back as a markdown table', async () => {
    const target = file('report.xlsx');
    const created = await writeExcel(target, [
      { name: 'Sales', data: [['Region', 'Total'], ['APAC', 100], ['EMEA', 250]] },
    ]);
    expect(created).toContain('1 sheet(s)');
    expect(fs.existsSync(target)).toBe(true);

    const md = await readExcel(target);
    expect(md).toContain('Sheet: Sales');
    expect(md).toContain('| Region | Total |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| APAC | 100 |');
    expect(md).toContain('| EMEA | 250 |');
  });

  it('selects a named sheet and reports missing sheets', async () => {
    const target = file('multi.xlsx');
    await writeExcel(target, [
      { name: 'First', data: [['a'], [1]] },
      { name: 'Second', data: [['b'], [2]] },
    ]);

    expect(await readExcel(target, 'Second')).toContain('| b |');
    const missing = await readExcel(target, 'Nope');
    expect(missing).toContain('Error: Sheet "Nope" not found');
    expect(missing).toContain('First, Second');
  });
});

describe('editExcel', () => {
  it('updates cells in place with correct types', async () => {
    const target = file('editable.xlsx');
    await writeExcel(target, [{ name: 'Data', data: [['Name', 'Score'], ['ann', 1]] }]);

    const result = await editExcel(target, 'Data', [
      { cell: 'A2', value: 'Bob' },
      { cell: 'B2', value: 99 },
    ]);
    expect(result).toContain('Updated 2 cell(s)');

    const md = await readExcel(target);
    expect(md).toContain('| Bob | 99 |');
    expect(md).not.toContain('ann');
  });

  it('reports a missing sheet without touching the file', async () => {
    const target = file('untouched.xlsx');
    await writeExcel(target, [{ name: 'Only', data: [['x'], [1]] }]);

    const result = await editExcel(target, 'Ghost', [{ cell: 'A1', value: 'y' }]);
    expect(result).toContain('Error: Sheet "Ghost" not found');
    expect(await readExcel(target)).toContain('| x |');
  });
});

describe('extractXlsx', () => {
  it('renders every non-empty sheet as a markdown section', async () => {
    const target = file('extract.xlsx');
    await writeExcel(target, [
      { name: 'People', data: [['Name'], ['Ann'], ['Bob']] },
      { name: 'Empty', data: [] },
    ]);

    const result = await extractXlsx(fs.readFileSync(target));
    expect(result.text).toContain('--- Sheet: People ---');
    expect(result.text).toContain('| Ann |');
    expect(result.text).not.toContain('--- Sheet: Empty ---');
    expect(result.pageCount).toBe(2);
    expect(result.metadata).toMatchObject({ type: 'xlsx', sheetNames: ['People', 'Empty'] });
  });
});
