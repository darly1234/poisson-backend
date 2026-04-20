const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

const sftp = new Client();

const config = {
  host: '72.60.254.10',
  port: 22,
  username: 'root',
  password: 'i5dAN0hN.HNAlWaYtS.'
};

async function uploadExcel() {
  try {
    console.log('Iniciando upload do arquivo Excel para a VPS...');
    await sftp.connect(config);
    
    const localPath = 'c:/poisson-erp/PowerP2_-_Editora_Poisson-1.xlsx';
    const remotePath = '/var/www/poisson-backend/PowerP2_-_Editora_Poisson-1.xlsx';
    
    if (fs.existsSync(localPath)) {
      await sftp.put(localPath, remotePath);
      console.log('Upload do Excel concluído com SUCESSO!');
    } else {
      console.error('ERRO: Arquivo local não encontrado em ' + localPath);
    }
  } catch (err) {
    console.error('Erro no SFTP:', err);
  } finally {
    await sftp.end();
  }
}

uploadExcel();
