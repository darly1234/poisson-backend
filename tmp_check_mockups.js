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
    const settings = res.rows[0]; // Wait, the previous output showed an array of rows. 
    // Usually settings has one row with 'key' and 'value' or just JSON fields.
    // Based on previous output, it looked like a row with a JSON blob.
    
    // Let's print the keys of the first row to be sure.
    const row = res.rows[0];
    console.log('Row keys:', Object.keys(row));
    
    // If it has 'mockup_templates' in a JSON field (e.g. 'settings_data' or 'value')
    // Based on Step 611, the output showed "mockup_templates": [ ... ]
    // which seems to be inside a larger object.
    
    // Let's assume the first row has the data.
    const data = row; // Adjust if needed
    if (data.mockup_templates) {
       console.log('FOUND mockup_templates:', data.mockup_templates.map(t => ({ id: t.id, name: t.name, folderId: t.folderId })));
    } else {
       console.log('mockup_templates missing in top level. Checking nested?');
       // In Step 611, it looked like the output was from a console.log(res.rows)
       // and one of the fields was an object containing mockup_templates.
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
