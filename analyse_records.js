const { Client } = require('pg');
const pool = new Client({
  host: 'localhost',
  port: 5432,
  database: 'poisson_erp',
  user: 'postgres',
  password: 'ylrad320@',
});

async function run() {
  await pool.connect();
  const res = await pool.query(`
    SELECT id, data->>'url' as url, data->>'full_url' as full_url 
    FROM records 
    WHERE id LIKE 'I-%' OR id LIKE 'C-%' 
    LIMIT 20
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  await pool.end();
}

run().catch(console.error);
