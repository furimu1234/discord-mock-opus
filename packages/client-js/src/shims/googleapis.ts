import { db } from '../db/index.js';
import type { CellValue, ValueOptions } from '../db/sheets.js';

interface ValuesParams extends ValueOptions {
  spreadsheetId: string;
  range: string;
  requestBody?: { values?: CellValue[][]; majorDimension?: ValueOptions['majorDimension'] };
  resource?: { values?: CellValue[][] };
}

interface BatchGetParams extends ValueOptions {
  spreadsheetId: string;
  ranges: string[];
}

interface BatchValuesParams {
  spreadsheetId: string;
  requestBody: {
    data?: { range: string; values: CellValue[][] }[];
    ranges?: string[];
    valueInputOption?: ValueOptions['valueInputOption'];
  };
}

const respond = <T>(data: T) => ({ data, status: 200, statusText: 'OK', headers: {} });

const bodyOf = (params: ValuesParams) => params.requestBody ?? params.resource ?? {};

function sheetsClient() {
  const engine = () => db.sheets();
  return {
    spreadsheets: {
      get: async ({ spreadsheetId }: { spreadsheetId: string }) => respond(engine().metadata(spreadsheetId)),
      create: async ({ requestBody }: { requestBody?: Record<string, any> } = {}) => {
        const titles = requestBody?.sheets?.map((sheet: Record<string, any>) => sheet.properties?.title);
        const spreadsheetId = engine().create(requestBody?.properties?.title, titles);
        return respond(engine().metadata(spreadsheetId));
      },
      batchUpdate: async ({ spreadsheetId, requestBody }: { spreadsheetId: string; requestBody: Record<string, any> }) =>
        respond(engine().batchUpdate(spreadsheetId, requestBody.requests)),
      values: {
        get: async (params: ValuesParams) => respond(engine().getValues(params.spreadsheetId, params.range, params)),
        batchGet: async (params: BatchGetParams) =>
          respond({
            spreadsheetId: params.spreadsheetId,
            valueRanges: params.ranges.map((range) => engine().getValues(params.spreadsheetId, range, params)),
          }),
        update: async (params: ValuesParams) =>
          respond(engine().updateValues(params.spreadsheetId, params.range, bodyOf(params).values ?? [], params)),
        append: async (params: ValuesParams) =>
          respond(engine().appendValues(params.spreadsheetId, params.range, bodyOf(params).values ?? [], params)),
        clear: async (params: ValuesParams) => respond(engine().clearValues(params.spreadsheetId, params.range)),
        batchUpdate: async ({ spreadsheetId, requestBody }: BatchValuesParams) => {
          const options = { valueInputOption: requestBody.valueInputOption };
          const responses = (requestBody.data ?? []).map((item) =>
            engine().updateValues(spreadsheetId, item.range, item.values, options),
          );
          return respond({ spreadsheetId, responses });
        },
        batchClear: async ({ spreadsheetId, requestBody }: BatchValuesParams) => {
          const clearedRanges = requestBody.ranges ?? [];
          for (const range of clearedRanges) engine().clearValues(spreadsheetId, range);
          return respond({ spreadsheetId, clearedRanges });
        },
      },
    },
  };
}

class MockAuth {
  constructor(_options?: unknown) {}
  async getClient() {
    return this;
  }
  async authorize() {
    return {};
  }
  setCredentials(): void {}
}

const supported = {
  sheets: sheetsClient,
  auth: { GoogleAuth: MockAuth, JWT: MockAuth, OAuth2: MockAuth },
};

/** Sheets 以外の API は対象外のため、誤って使うとエラーにする。 */
export const google: typeof supported = new Proxy(supported, {
  get(target, key) {
    if (key in target) return target[key as keyof typeof target];
    throw new Error(`@dismock/client: google.${String(key)} には対応していません`);
  },
});

export const sheets = sheetsClient;

export default { google };
