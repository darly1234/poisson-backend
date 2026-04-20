const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec('netstat -tpln | grep :8030', (err, stream) => {
    if (err) throw err;
    stream.on('data', (data) => console.log(String(data)));
    stream.on('close', () => conn.end());
  });
}).connect({
  host: '72.60.254.10',
  port: 22,
  username: 'root',
  password: 'i5dAN0hN.HNAlWaYtS.'
});
