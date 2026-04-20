const Client = require('ssh2-sftp-client');
const sftp = new Client();
const config = { host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' };

async function upload() {
  try {
    await sftp.connect(config);
    await sftp.put('c:/poisson-erp/build_v2.93.5.zip', '/var/www/poisson-erp/build.zip');
    console.log('Upload OK');
  } catch (err) {
    console.error(err);
  } finally {
    await sftp.end();
  }
}
upload();
