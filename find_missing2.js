
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS });

async function run() {
  const { rows } = await pool.query("SELECT * FROM records WHERE id LIKE 'A-%'");
  for (const r of rows) {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    const title = (data.titulo_do_documento || data.titulo_artigo || data.titulo || '').toLowerCase();
    
    // Test some keywords for the missing 9:
    if (title.includes('endocarpo do buriti')) console.log(r.id, title);
    if (title.includes('buriti')) console.log(r.id, title);
  }
  process.exit(0);
}
run();
