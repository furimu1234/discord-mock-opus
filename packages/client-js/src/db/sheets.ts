import { SNAPSHOT_ROW_LIMIT, type DbTable, type Engine } from './types.js';

export type CellValue = string | number | boolean | null;
export type SheetSeed = Record<string, Record<string, CellValue[][]>>;

interface Sheet {
  sheetId: number;
  title: string;
  cells: CellValue[][];
}

interface Spreadsheet {
  spreadsheetId: string;
  title: string;
  sheets: Sheet[];
}

interface GridRange {
  sheet: Sheet;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

export interface ValueOptions {
  majorDimension?: 'ROWS' | 'COLUMNS';
  valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
  valueInputOption?: 'RAW' | 'USER_ENTERED';
}

/** Google API のエラー（GaxiosError）と同じ `code` を持つエラー。 */
export class SheetsError extends Error {
  readonly status: number;
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.status = code;
  }
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function columnLetters(index: number): string {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

function rangeLabel(range: GridRange, rows: number, columns: number): string {
  const start = `${columnLetters(range.startColumn)}${range.startRow + 1}`;
  const end = `${columnLetters(range.startColumn + columns - 1)}${range.startRow + rows}`;
  return `${range.sheet.title}!${start}:${end}`;
}

function format(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

function parseUserEntered(value: CellValue): CellValue {
  if (typeof value !== 'string' || value === '') return value;
  if (/^(TRUE|FALSE)$/i.test(value)) return value.toUpperCase() === 'TRUE';
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
}

/** Google Sheets API v4 の主要な操作を再現するインメモリのスプレッドシート。 */
export class SheetsEngine implements Engine {
  readonly kind = 'sheets';
  private readonly spreadsheets = new Map<string, Spreadsheet>();
  private nextSheetId = 1;

  create(title = 'Untitled spreadsheet', sheetTitles: string[] = ['Sheet1'], id?: string): string {
    const spreadsheetId = id ?? crypto.randomUUID().replaceAll('-', '');
    this.spreadsheets.set(spreadsheetId, {
      spreadsheetId,
      title,
      sheets: sheetTitles.map((sheetTitle) => this.newSheet(sheetTitle)),
    });
    return spreadsheetId;
  }

  private newSheet(title: string): Sheet {
    const sheetId = this.nextSheetId;
    this.nextSheetId += 1;
    return { sheetId, title, cells: [] };
  }

  /** `{ スプレッドシートID: { シート名: 行の配列 } }` の形で投入する。 */
  seed(data: SheetSeed): void {
    for (const [spreadsheetId, sheets] of Object.entries(data)) {
      if (!this.spreadsheets.has(spreadsheetId)) {
        this.create(spreadsheetId, Object.keys(sheets), spreadsheetId);
      }
      const spreadsheet = this.require(spreadsheetId);
      for (const [title, rows] of Object.entries(sheets)) {
        let sheet = spreadsheet.sheets.find((s) => s.title === title);
        if (!sheet) {
          sheet = this.newSheet(title);
          spreadsheet.sheets.push(sheet);
        }
        sheet.cells = rows.map((row) => [...row]);
      }
    }
  }

  private require(spreadsheetId: string): Spreadsheet {
    const spreadsheet = this.spreadsheets.get(spreadsheetId);
    if (!spreadsheet) throw new SheetsError(404, 'Requested entity was not found.');
    return spreadsheet;
  }

  private parseRange(spreadsheetId: string, range: string): GridRange {
    const spreadsheet = this.require(spreadsheetId);
    const invalid = () => new SheetsError(400, `Unable to parse range: ${range}`);
    const separator = range.lastIndexOf('!');
    const title = separator >= 0 ? range.slice(0, separator).replace(/^'(.*)'$/, '$1') : undefined;
    let cells = separator >= 0 ? range.slice(separator + 1) : range;
    let sheet = title ? spreadsheet.sheets.find((s) => s.title === title) : undefined;
    if (title && !sheet) throw invalid();
    if (!title) {
      sheet = spreadsheet.sheets.find((s) => s.title === range.replace(/^'(.*)'$/, '$1'));
      if (sheet) cells = '';
      else sheet = spreadsheet.sheets[0];
    }
    if (!sheet) throw invalid();
    if (!cells) {
      return { sheet, startRow: 0, startColumn: 0, endRow: Infinity, endColumn: Infinity };
    }
    const match = /^([A-Za-z]*)(\d*)(?::([A-Za-z]*)(\d*))?$/.exec(cells);
    if (!match) throw invalid();
    const [, startColumn, startRow, endColumn, endRow] = match;
    const isSingleCell = !cells.includes(':');
    return {
      sheet,
      startRow: startRow ? Number(startRow) - 1 : 0,
      startColumn: startColumn ? columnIndex(startColumn) : 0,
      endRow: endRow ? Number(endRow) : isSingleCell && startRow ? Number(startRow) : Infinity,
      endColumn: endColumn
        ? columnIndex(endColumn) + 1
        : isSingleCell && startColumn
          ? columnIndex(startColumn) + 1
          : Infinity,
    };
  }

  getValues(spreadsheetId: string, range: string, options: ValueOptions = {}) {
    const grid = this.parseRange(spreadsheetId, range);
    const render = (value: CellValue | undefined): CellValue =>
      options.valueRenderOption === 'UNFORMATTED_VALUE' ? (value ?? '') : format(value);

    const rows = grid.sheet.cells.slice(grid.startRow, grid.endRow).map((row) => {
      const cells = row.slice(grid.startColumn, grid.endColumn).map(render);
      while (cells.length > 0 && cells.at(-1) === '') cells.pop();
      return cells;
    });
    while (rows.length > 0 && rows.at(-1)!.length === 0) rows.pop();

    const width = Math.max(0, ...rows.map((row) => row.length));
    const label = rows.length > 0 ? rangeLabel(grid, rows.length, width) : `${grid.sheet.title}!${range.split('!').pop()}`;
    const majorDimension = options.majorDimension ?? 'ROWS';
    const values =
      majorDimension === 'COLUMNS'
        ? Array.from({ length: width }, (_, column) => rows.map((row) => row[column] ?? ''))
        : rows;
    return { range: label, majorDimension, ...(rows.length > 0 ? { values } : {}) };
  }

  private write(grid: GridRange, startRow: number, values: CellValue[][], options: ValueOptions) {
    const rows = options.majorDimension === 'COLUMNS' ? this.transpose(values) : values;
    const { cells } = grid.sheet;
    rows.forEach((row, rowOffset) => {
      const target = (cells[startRow + rowOffset] ??= []);
      row.forEach((value, columnOffset) => {
        // Sheets API では null のセルは更新されない。
        if (value === null) return;
        target[grid.startColumn + columnOffset] =
          options.valueInputOption === 'USER_ENTERED' ? parseUserEntered(value) : value;
      });
    });
    for (let i = 0; i < cells.length; i += 1) cells[i] ??= [];
    const updatedColumns = Math.max(0, ...rows.map((row) => row.length));
    return {
      updatedRange: rangeLabel({ ...grid, startRow }, rows.length, updatedColumns),
      updatedRows: rows.length,
      updatedColumns,
      updatedCells: rows.reduce((total, row) => total + row.length, 0),
    };
  }

  private transpose(values: CellValue[][]): CellValue[][] {
    const height = Math.max(0, ...values.map((column) => column.length));
    return Array.from({ length: height }, (_, row) => values.map((column) => column[row] ?? null));
  }

  updateValues(spreadsheetId: string, range: string, values: CellValue[][], options: ValueOptions = {}) {
    const grid = this.parseRange(spreadsheetId, range);
    return { spreadsheetId, ...this.write(grid, grid.startRow, values, options) };
  }

  appendValues(spreadsheetId: string, range: string, values: CellValue[][], options: ValueOptions = {}) {
    const grid = this.parseRange(spreadsheetId, range);
    let startRow = grid.startRow;
    grid.sheet.cells.forEach((row, i) => {
      const hasValue = row
        .slice(grid.startColumn, grid.endColumn)
        .some((value) => value !== null && value !== undefined && value !== '');
      if (hasValue && i >= startRow) startRow = i + 1;
    });
    const updates = this.write(grid, startRow, values, options);
    return { spreadsheetId, tableRange: range, updates: { spreadsheetId, ...updates } };
  }

  clearValues(spreadsheetId: string, range: string) {
    const grid = this.parseRange(spreadsheetId, range);
    const end = Math.min(grid.endRow, grid.sheet.cells.length);
    for (let row = grid.startRow; row < end; row += 1) {
      const cells = grid.sheet.cells[row] ?? [];
      const stop = Math.min(grid.endColumn, cells.length);
      for (let column = grid.startColumn; column < stop; column += 1) cells[column] = '';
    }
    return { spreadsheetId, clearedRange: range };
  }

  metadata(spreadsheetId: string) {
    const spreadsheet = this.require(spreadsheetId);
    return {
      spreadsheetId,
      properties: { title: spreadsheet.title, locale: 'ja_JP' },
      sheets: spreadsheet.sheets.map((sheet, index) => ({
        properties: { sheetId: sheet.sheetId, title: sheet.title, index, sheetType: 'GRID' },
      })),
    };
  }

  batchUpdate(spreadsheetId: string, requests: Record<string, any>[]) {
    const spreadsheet = this.require(spreadsheetId);
    const replies = requests.map((request) => {
      if (request.addSheet) {
        const sheet = this.newSheet(request.addSheet.properties?.title ?? `Sheet${spreadsheet.sheets.length + 1}`);
        spreadsheet.sheets.push(sheet);
        return { addSheet: { properties: { sheetId: sheet.sheetId, title: sheet.title } } };
      }
      if (request.deleteSheet) {
        spreadsheet.sheets = spreadsheet.sheets.filter((s) => s.sheetId !== request.deleteSheet.sheetId);
        return {};
      }
      if (request.updateSheetProperties) {
        const { properties } = request.updateSheetProperties;
        const sheet = spreadsheet.sheets.find((s) => s.sheetId === properties.sheetId);
        if (sheet && properties.title) sheet.title = properties.title;
        return {};
      }
      throw new SheetsError(400, `Unsupported request: ${Object.keys(request).join(', ')}`);
    });
    return { spreadsheetId, replies };
  }

  /** テストコードからセルの値を読み取る。 */
  values(spreadsheetId: string, range: string, options?: ValueOptions): CellValue[][] {
    return this.getValues(spreadsheetId, range, options).values ?? [];
  }

  snapshot(): DbTable[] {
    return [...this.spreadsheets.values()].flatMap((spreadsheet) =>
      spreadsheet.sheets.map((sheet) => {
        const width = Math.max(0, ...sheet.cells.map((row) => row.length));
        const columns = Array.from({ length: width }, (_, i) => ({
          name: columnLetters(i),
          type: 'cell',
          primaryKey: false,
        }));
        return {
          name: `${spreadsheet.spreadsheetId} / ${sheet.title}`,
          columns,
          rows: sheet.cells
            .slice(0, SNAPSHOT_ROW_LIMIT)
            .map((row) => Object.fromEntries(columns.map((column, i) => [column.name, row[i] ?? null]))),
          total: sheet.cells.length,
        };
      }),
    );
  }

  async reset(): Promise<void> {
    for (const spreadsheet of this.spreadsheets.values()) {
      for (const sheet of spreadsheet.sheets) sheet.cells = [];
    }
  }

  async close(): Promise<void> {
    this.spreadsheets.clear();
  }
}
