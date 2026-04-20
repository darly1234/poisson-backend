const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('Connected to VPS...');
    conn.exec('cd /var/www/poisson-backend && npm install mammoth && pm2 restart poisson-api', (err, stream) => {
        if (err) throw err;
        stream.on('close', () => { conn.end(); }).on('data', d => process.stdout.write(d)).stderr.on('data', d => process.stderr.write(d));
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
