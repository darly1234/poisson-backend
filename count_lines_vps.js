const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec('wc -l /var/www/backend-academic/main.py', (err, stream) => {
    if (err) throw err;
    stream.on('data', (data) => {
      console.log(String(data));
    }).on('close', () => {
      conn.end();
    });
  });
}).connect({
  host: '72.60.254.10',
  port: 22,
  username: 'root',
  password: 'i5dAN0hN.HNAlWaYtS.'
});
