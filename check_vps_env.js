const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    const script = `
cat /var/www/poisson-backend/.env || echo "No .env"
pm2 logs poisson-api --lines 50
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('close', () => { console.log(out.trim()); conn.end(); })
            .on('data', data => out += data)
            .stderr.on('data', data => out += data);
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
