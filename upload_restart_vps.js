const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH conectado. Fazendo upload de main.py e reiniciando...');
  conn.sftp((err, sftp) => {
    if (err) throw err;
    sftp.fastPut('c:\\poisson-backend\\main_vps.py', '/var/www/backend-academic/main.py', (err) => {
      if (err) throw err;
      console.log('Arquivo enviado.');
      // Restart: try pm2 first, then look for uvicorn
      conn.exec('pm2 restart academic || pkill -f uvicorn && cd /var/www/backend-academic && nohup python3 -m uvicorn main:app --host 0.0.0.0 --port 8030 > uvicorn.log 2>&1 &', (err, stream) => {
        if (err) throw err;
        stream.on('data', (data) => console.log('STDOUT: ' + data));
        stream.stderr.on('data', (data) => console.log('STDERR: ' + data));
        stream.on('close', () => {
          console.log('Comando de reinicialização enviado.');
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
