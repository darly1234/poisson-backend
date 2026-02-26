const { Client } = require('ssh2');
const conn = new Client();

const script = `
sed -i 's/VPS_SSH_HOST=.*/VPS_SSH_HOST=127.0.0.1/' /var/www/poisson-backend/.env
cat /var/www/poisson-backend/.env
pm2 restart poisson-api --update-env
`;

conn.on('ready', () => {
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
            .on('data', d => process.stdout.write(d))
            .stderr.on('data', d => process.stderr.write(d));
    });
}).connect({
    host: '72.60.254.10',
    port: 22,
    username: 'root',
    password: 'i5dAN0hN.HNAlWaYtS.'
});
