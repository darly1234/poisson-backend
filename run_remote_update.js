const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const REMOTE_SCRIPT = '/var/www/poisson-backend/update_articles.js';
const LOCAL_SCRIPT = path.join(__dirname, 'update_articles.js');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH conectado. Enviando script...');
  conn.sftp((err, sftp) => {
    if (err) { console.error(err); conn.end(); return; }
    sftp.fastPut(LOCAL_SCRIPT, REMOTE_SCRIPT, (err) => {
      if (err) { console.error('Erro upload:', err); conn.end(); return; }
      console.log('Script enviado. Executando...');
      const cmd = `cd /var/www/poisson-backend && node update_articles.js && rm update_articles.js`;
      conn.exec(cmd, (err, stream) => {
        if (err) { console.error(err); conn.end(); return; }
        stream.on('data', d => process.stdout.write(String(d)));
        stream.stderr.on('data', d => process.stderr.write(String(d)));
        stream.on('close', (code) => {
          console.log('Execução finalizada, code:', code);
          conn.end();
        });
      });
    });
  });
}).connect({
  host: '72.60.254.10',
  port: 22,
  username: 'root',
  password: 'i5dAN0hN.HNAlWaYtS.'
});
