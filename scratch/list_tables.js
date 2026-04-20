const mysql = require('mysql2/promise');

async function listTables() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'darly_wp67237',
    password: 'S]5ZvH8.7p',
    database: 'darly_wp67237'
  });

  try {
    const [rows] = await connection.execute("SHOW TABLES");
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

listTables();
