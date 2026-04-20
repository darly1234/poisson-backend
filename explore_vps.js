const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH conectado. Explorando VPS...');
  conn.exec('ls -d /var/www/*', (err, stream) => {
    if (err) throw err;
    stream.on('data', (data) => {
      console.log('STDOUT: ' + data);
    }).on('close', (code, signal) => {
      console.log('Finalizado com código ' + code);
      conn.end();
    });
  });
}).connect({
  host: '72.60.254.10',
  port: 22,
  username: 'root',
  password: 'i5dAN0hN.HNAlWaYtS.'
});
