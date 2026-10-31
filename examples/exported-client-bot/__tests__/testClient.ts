import * as disMock from '@dismock/client';
import { client } from '../src/bot.ts';

class MyTestBotClient extends disMock.TestClient {
  visitNames(): Promise<string[]> {
    return disMock.db.pg().query<{ name: string }>('SELECT name FROM visits').then((rows) => rows.map((row) => row.name));
  }
}

export const testClient = new MyTestBotClient(client, {
  token: disMock.connection().token,
  commands: [{ name: 'hi', description: 'Say hi' }],
  setupDb: () => disMock.db.pg().query('CREATE TABLE visits (name text)').then(() => undefined),
});
