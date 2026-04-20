const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH conectado. Lendo main.py (parte 1)...');
  conn.exec('head -n 1120 /var/www/backend-academic/main.py', (err, stream) => {
    if (err) throw err;
    let content = '';
    stream.on('data', (data) => {
      content += String(data);
    }).on('close', (code, signal) => {
      console.log('--- START ---');
      console.log(content);
      console.log('--- END ---');
      conn.end();
    });
  });
}).connect({
  host: '72.60.254.10',
  port: 22,
  username: 'root',
  password: 'i5dAN0hN.HNAlWaYtS.'
});
