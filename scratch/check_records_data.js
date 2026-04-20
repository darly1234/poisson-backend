const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'poisson_erp', user: 'postgres', password: 'ylrad320@',
});

async function checkRecords() {
  try {
    const { rows } = await pool.query("SELECT id, data->>'arquivo_artigo' as file, data->'avaliacao_dados' as eval FROM records WHERE id LIKE 'A-%' LIMIT 10");
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

checkRecords();
