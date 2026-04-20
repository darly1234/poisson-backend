const mysql = require('mysql2/promise');

async function checkGF() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'darly_wp67237',
    password: 'S]5ZvH8.7p',
    database: 'darly_wp67237'
  });

  try {
    const [rows] = await connection.execute(
      "SELECT meta_key, meta_value FROM wp8g_gf_entry_meta WHERE entry_id = 4813"
    );
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

checkGF();
