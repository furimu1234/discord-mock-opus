import * as disMock from '@dismock/client';

// Bot のソースコードは一切変更していない。
export const testClient = disMock.testClient({
  entry: 'src/index.ts',
  setupDb: async () => {
    await disMock.db.pg().query(`
      CREATE TABLE levels (user_id text PRIMARY KEY, level integer NOT NULL DEFAULT 0)
    `);
    disMock.db.mysql().query(`
      CREATE TABLE notes (
        id INT NOT NULL AUTO_INCREMENT,
        user_id VARCHAR(32) NOT NULL,
        body TEXT COLLATE utf8mb4_general_ci,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    disMock.db.sqlite().query('CREATE TABLE tags (name TEXT PRIMARY KEY, content TEXT NOT NULL)');
  },
});
