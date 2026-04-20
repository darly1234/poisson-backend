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
    const res = await pool.query("SELECT * FROM settings WHERE key = 'settings'");
    if (res.rows.length === 0) {
      console.log('No settings found');
      return;
    }
    const row = res.rows[0];
    const settings = JSON.parse(row.value);
    
    if (settings.mockup_templates) {
       console.log('MOCKUP_TEMPLATES:', JSON.stringify(settings.mockup_templates.map(t => ({ id: t.id, name: t.name, folderId: t.folderId })), null, 2));
    } else {
       console.log('mockup_templates NOT FOUND in parsed value');
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
