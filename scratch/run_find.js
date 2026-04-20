const Client = require('ssh2-sftp-client');
const { Client: SSHClient } = require('ssh2');
const sftp = new Client();
const config = { host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' };

async function run() {
  try {
    await sftp.connect(config);
    await sftp.put('c:/poisson-backend/scratch/find_article.js', '/var/www/poisson-backend/find_article.js');
    await sftp.end();
    const conn = new SSHClient();
    conn.on('ready', () => {
      conn.exec('cd /var/www/poisson-backend && node find_article.js', (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end()).on('data', d => process.stdout.write(d)).stderr.on('data', d => process.stderr.write(d));
      });
    }).connect(config);
  } catch (err) {
    console.error(err);
  }
}
run();
