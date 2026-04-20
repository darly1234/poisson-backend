const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'poisson_erp', user: 'postgres', password: 'ylrad320@',
});

async function findArticle() {
  try {
    const { rows } = await pool.query("SELECT id, data FROM records WHERE data->>'titulo_artigo' ILIKE '%A IMPORTÂNCIA DA LEITURA%'");
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

findArticle();
