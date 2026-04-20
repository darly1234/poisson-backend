const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const REMOTE_SCRIPT = '/var/www/poisson-backend/find_missing2.js';
const LOCAL_SCRIPT = path.join(__dirname, 'find_missing2.js');

const scriptCode = `
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS });

async function run() {
  const { rows } = await pool.query("SELECT * FROM records WHERE id LIKE 'A-%'");
  for (const r of rows) {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    const title = (data.titulo_do_documento || data.titulo_artigo || data.titulo || '').toLowerCase();
    
    // Test some keywords for the missing 9:
    if (title.includes('endocarpo do buriti')) console.log(r.id, title);
    if (title.includes('buriti')) console.log(r.id, title);
  }
  process.exit(0);
}
run();
`;
fs.writeFileSync(LOCAL_SCRIPT, scriptCode);

const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    sftp.fastPut(LOCAL_SCRIPT, REMOTE_SCRIPT, (err) => {
      conn.exec('cd /var/www/poisson-backend && node find_missing2.js && rm find_missing2.js', (err, stream) => {
        stream.on('data', d => process.stdout.write(String(d)));
        stream.on('close', () => conn.end());
      });
    });
  });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
