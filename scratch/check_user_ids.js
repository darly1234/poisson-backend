const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'poisson_erp', user: 'postgres', password: 'ylrad320@',
});

async function check() {
  try {
    const ids = ['A-0642', 'A-0641', 'A-0640', 'A-0638', 'A-0637', 'A-0636', 'A-0635'];
    const { rows } = await pool.query('SELECT id, data FROM records WHERE id = ANY($1)', [ids]);
    
    for (const r of rows) {
        const d = r.data;
        const files = Object.keys(d).filter(k => k.startsWith('arquivo_')).reduce((obj, key) => {
            obj[key] = d[key];
            return obj;
        }, {});
        console.log('ID:', r.id);
        console.log('Files:', JSON.stringify(files, null, 2));
        console.log('Eval Status:', d.avaliacao_dados?.status_avaliacao);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
