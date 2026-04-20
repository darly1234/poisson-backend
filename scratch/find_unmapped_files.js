const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'poisson_erp', user: 'postgres', password: 'ylrad320@',
});

async function check() {
  try {
    const { rows } = await pool.query(`
      SELECT id, data FROM records 
      WHERE (data->'avaliacao_dados'->>'status_avaliacao' = 'Pendente' OR data->'avaliacao_dados'->>'status_avaliacao' IS NULL)
      AND data->>'arquivo_artigo' IS NULL
      AND data->>'arquivo_original' IS NULL
      AND data->>'arquivo_dissertacao' IS NULL
      AND data->>'arquivo_tese' IS NULL
      AND data->>'arquivo_monografia' IS NULL
      AND data->>'arquivo_tcc' IS NULL
      LIMIT 10
    `);
    
    for (const r of rows) {
        console.log('ID:', r.id);
        console.log('Keys:', Object.keys(r.data).filter(k => r.data[k] && typeof r.data[k] === 'string' && r.data[k].includes('.pdf')));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
