const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH conectado. Baixando main.py...');
  conn.sftp((err, sftp) => {
    if (err) throw err;
    sftp.fastGet('/var/www/backend-academic/main.py', 'c:\\poisson-backend\\main_vps.py', (err) => {
      if (err) throw err;
      console.log('Arquivo baixado em c:\\poisson-backend\\main_vps.py');
      conn.end();
    });
  });
}).connect({
  host: '72.60.254.10',
  port: 22,
  username: 'root',
  password: 'i5dAN0hN.HNAlWaYtS.'
});
