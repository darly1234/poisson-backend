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
    const res = await pool.query("SELECT value FROM settings WHERE key = 'mockup_templates'");
    if (res.rows.length === 0) {
      console.log('No mockup_templates found');
      return;
    }
    let templates = res.rows[0].value;
    if (typeof templates === 'string') {
        try {
            templates = JSON.parse(templates);
        } catch (e) {
            console.log('Could not parse string as JSON:', templates.substring(0, 100));
        }
    }
    
    if (Array.isArray(templates)) {
       console.log('MOCKUP_TEMPLATES:', JSON.stringify(templates.map(t => ({ id: t.id, name: t.name, folderId: t.folderId })), null, 2));
    } else {
       console.log('Templates is not an array:', typeof templates, templates);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
