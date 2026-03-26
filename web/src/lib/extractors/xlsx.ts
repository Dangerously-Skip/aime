/**
 * Excel spreadsheet extraction and manipulation using xlsx (SheetJS).
 */
import type { ExtractionResult } from './types';

/**
 * Extract text from an Excel file as markdown tables per sheet.
 */
export async function extractXlsx(buffer: Buffer): Promise<ExtractionResult> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (!csv.trim()) continue;

    // Convert CSV to markdown table
    const rows = csv.split('\n').filter((r: string) => r.trim());
    if (rows.length === 0) continue;

    const mdRows = rows.map((row: string) => {
      const cells = row.split(',').map((c: string) => c.trim());
      return `| ${cells.join(' | ')} |`;
    });
    // Insert header separator after first row
    if (mdRows.length > 0) {
      const headerCells = rows[0].split(',');
      const separator = `| ${headerCells.map(() => '---').join(' | ')} |`;
      mdRows.splice(1, 0, separator);
    }

    sheets.push(`--- Sheet: ${sheetName} ---\n${mdRows.join('\n')}`);
  }

  return {
    text: sheets.join('\n\n'),
    pageCount: workbook.SheetNames.length,
    metadata: {
      type: 'xlsx',
      sheetNames: workbook.SheetNames,
    },
  };
}

/**
 * Read a specific sheet/range from an Excel file and return as markdown table.
 * Used by the ExcelRead MCP tool.
 */
export async function readExcel(
  filePath: string,
  sheetName?: string,
  range?: string,
): Promise<string> {
  const XLSX = await import('xlsx');
  const fs = await import('fs');
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const targetSheet = sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[targetSheet];
  if (!sheet) {
    return `Error: Sheet "${targetSheet}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`;
  }

  const opts: Record<string, unknown> = {};
  if (range) opts.range = range;

  const csv = XLSX.utils.sheet_to_csv(sheet, opts);
  const rows = csv.split('\n').filter((r: string) => r.trim());
  if (rows.length === 0) return '(empty sheet)';

  const mdRows = rows.map((row: string) => {
    const cells = row.split(',').map((c: string) => c.trim());
    return `| ${cells.join(' | ')} |`;
  });
  if (mdRows.length > 0) {
    const headerCells = rows[0].split(',');
    const separator = `| ${headerCells.map(() => '---').join(' | ')} |`;
    mdRows.splice(1, 0, separator);
  }

  return `Sheet: ${targetSheet}\n${mdRows.join('\n')}`;
}

/**
 * Create a new Excel workbook from data arrays.
 * Used by the ExcelWrite MCP tool.
 */
export async function writeExcel(
  filePath: string,
  sheets: Array<{ name: string; data: unknown[][] }>,
): Promise<string> {
  const XLSX = await import('xlsx');
  const fs = await import('fs');
  const path = await import('path');

  const workbook = XLSX.utils.book_new();
  for (const { name, data } of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  XLSX.writeFile(workbook, filePath);
  return `Created ${filePath} with ${sheets.length} sheet(s)`;
}

/**
 * Edit cells in an existing Excel file.
 * Used by the ExcelEdit MCP tool.
 */
export async function editExcel(
  filePath: string,
  sheetName: string,
  edits: Array<{ cell: string; value: string | number | boolean }>,
): Promise<string> {
  const XLSX = await import('xlsx');
  const fs = await import('fs');

  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return `Error: Sheet "${sheetName}" not found. Available: ${workbook.SheetNames.join(', ')}`;
  }

  for (const { cell, value } of edits) {
    sheet[cell] = { v: value, t: typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's' };
  }

  XLSX.writeFile(workbook, filePath);
  return `Updated ${edits.length} cell(s) in ${sheetName}`;
}
