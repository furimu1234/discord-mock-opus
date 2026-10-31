// CommonJS の Bot でも require が差し替わることを確認する。
const { Pool } = require('pg');

const pool = new Pool();

module.exports = {
  count: async () => (await pool.query('SELECT count(*)::int AS total FROM visits')).rows[0].total,
  visit: (name) => pool.query('INSERT INTO visits (name) VALUES ($1)', [name]),
};
