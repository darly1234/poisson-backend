const mysql = require('mysql2/promise');
const db = { host: 'localhost', user: 'darly_wp67237', password: 'S]5ZvH8.7p', database: 'darly_wp67237' };

async function run() {
  try {
    const gf = await mysql.createConnection(db);
    console.log('SUCCESS: Connected to WordPress DB');
    const [rows] = await gf.execute('SELECT COUNT(*) as total FROM wp8g_gf_entry WHERE form_id = 8');
    console.log('Entries in Form 8:', rows[0].total);
    await gf.end();
  } catch (e) {
    console.error('FAILED: Cannot connect to WordPress DB', e.message);
  }
}
run();
