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
      "SELECT entry_id, meta_value FROM wp8g_gf_entry_meta WHERE meta_key = '8' AND meta_value LIKE '%IMPORTÂNCIA DA LEITURA%'"
    );
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

checkGF();
