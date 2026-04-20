const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'poisson_erp', user: 'postgres', password: 'ylrad320@',
});

async function check() {
  try {
    const { rows } = await pool.query("SELECT id, data->'titulo_artigo' as titulo FROM records WHERE id = 'A-0106'");
    console.log(JSON.stringify(rows[0], null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
