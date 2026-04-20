const { Pool } = require('pg');
require('dotenv').config({ path: 'c:/poisson-backend/.env' });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

async function check() {
  try {
    const res = await pool.query("SELECT * FROM settings");
    if (res.rows.length === 0) {
      console.log('No settings found');
      return;
    }
    // settings usually has 'key' and 'value' or just one row with JSON
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
