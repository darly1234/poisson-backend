const Client = require('ssh2-sftp-client');
const fs = require('fs');
const sftp = new Client();

const config = {
  host: '72.60.254.10',
  port: 22,
  username: 'root',
  password: 'i5dAN0hN.HNAlWaYtS.'
};

async function uploadBuild() {
  try {
    console.log('Iniciando upload do build.zip para a VPS...');
    await sftp.connect(config);
    const localPath = 'c:/poisson-erp/build.zip';
    const remotePath = '/var/www/poisson-erp/build.zip';
    await sftp.put(localPath, remotePath);
    console.log('Upload do build.zip concluído com SUCESSO!');
  } catch (err) {
    console.error('Erro no SFTP:', err);
  } finally {
    await sftp.end();
  }
}

uploadBuild();
