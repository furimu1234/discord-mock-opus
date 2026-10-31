import * as disMock from '@dismock/client';

// Bot のソースコードは一切変更していない。テーブルも Bot の起動時に作られる。
export const testClient = disMock.testClient({ entry: 'src/index.ts' });
