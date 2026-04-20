const Client = require('ssh2-sftp-client');
const { Client: SSHClient } = require('ssh2');
const sftp = new Client();

const config = {
  host: '72.60.254.10',
  port: 22,
  username: 'root',
  password: 'i5dAN0hN.HNAlWaYtS.'
};

async function checkMigration() {
  try {
    await sftp.connect(config);
    const localPath = 'c:/poisson-backend/scratch/check_records_data.js';
    const remotePath = '/var/www/poisson-backend/check_records_data.js';
    await sftp.put(localPath, remotePath);
    await sftp.end();

    const conn = new SSHClient();
    conn.on('ready', () => {
      conn.exec('cd /var/www/poisson-backend && node check_records_data.js', (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
          .on('data', data => process.stdout.write(data))
          .stderr.on('data', data => process.stderr.write(data));
      });
    }).connect(config);
  } catch (err) {
    console.error(err);
  }
}

checkMigration();
