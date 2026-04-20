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
    const res = await pool.query("SELECT value FROM config WHERE key = 'settings'");
    if (res.rows.length === 0) {
      console.log('No settings found');
      return;
    }
    const settings = JSON.parse(res.rows[0].value);
    console.log(JSON.stringify(settings.mockup_templates.map(t => ({ id: t.id, name: t.name, folderId: t.folderId })), null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
