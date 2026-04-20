const { Client } = require('ssh2');
const fs = require('fs');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH READY');
  conn.sftp((err, sftp) => {
    if (err) throw err;
    
    // Upload Excel
    console.log('Uploading Excel...');
    sftp.fastPut('c:/poisson-erp/PowerP2_-_Editora_Poisson-1.xlsx', '/var/www/poisson-backend/PowerP2_-_Editora_Poisson-1.xlsx', {}, (err) => {
      if (err) console.error('Excel Upload Failed:', err.message);
      else console.log('Excel Uploaded.');
      
      // Upload Script
      console.log('Uploading Script...');
      sftp.fastPut('c:/poisson-backend/rebuild_articles_vps.js', '/var/www/poisson-backend/rebuild_articles.js', {}, (err) => {
        if (err) console.error('Script Upload Failed:', err.message);
        else console.log('Script Uploaded.');
        
        conn.end();
      });
    });
  });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
