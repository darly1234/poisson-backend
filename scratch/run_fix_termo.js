const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('Connected to VPS...');
    const sftp = require('ssh2-sftp-client');
    const s = new sftp();
    s.connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' }).then(() => {
        return s.put('c:/poisson-backend/scratch/fix_termo_status.js', '/var/www/poisson-backend/fix_termo_status.js');
    }).then(() => {
        conn.exec('cd /var/www/poisson-backend && node fix_termo_status.js', (err, stream) => {
            if (err) throw err;
            stream.on('close', () => { s.end(); conn.end(); }).on('data', d => process.stdout.write(d)).stderr.on('data', d => process.stderr.write(d));
        });
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
