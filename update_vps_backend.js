const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('SSH Ready. Updating backend...');
    conn.exec("cd /var/www/poisson-backend && git stash && git pull origin main && npm install && pm2 restart poisson-api", (err, stream) => {
        let out = '';
        stream.on('close', () => {
            console.log('Output from VPS:');
            console.log(out.trim());
            conn.end();
        }).on('data', d => out += d).stderr.on('data', d => out += d);
    });
}).connect({
    host: '72.60.254.10',
    port: 22,
    username: 'root',
    password: 'i5dAN0hN.HNAlWaYtS.'
});
