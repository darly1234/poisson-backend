const mysql = require('mysql2/promise');

async function checkGF() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'darly_wp67237',
    password: 'S]5ZvH8.7p',
    database: 'darly_wp67237'
  });

  try {
    const query = "SELECT * FROM wp8g_gf_entry_meta WHERE entry_id = (SELECT entry_id FROM wp8g_gf_entry_meta WHERE meta_key = '8' AND meta_value LIKE '%A IMPORTÂNCIA DA LEITURA%')";
    console.log('Query:', query);
    const [rows] = await connection.execute(query);
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

checkGF();
