const { Client } = require('ssh2');
const conn = new Client();

const envContentChanges = `
# Atualizando hosts para 127.0.0.1 para evitar problemas de rede interna na VPS
sed -i "s/VPS_SSH_HOST=.*/VPS_SSH_HOST=127.0.0.1/" /var/www/poisson-backend/.env
pm2 restart poisson-api
`;

conn.on('ready', () => {
    console.log('SSH Ready');
    conn.exec(envContentChanges, (err, stream) => {
        if (err) throw err;
        stream.on('close', (code, signal) => {
            console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
            conn.end();
        }).on('data', (data) => {
            console.log('STDOUT: ' + data);
        }).stderr.on('data', (data) => {
            console.log('STDERR: ' + data);
        });
    });
}).connect({
    host: '72.60.254.10',
    port: 22,
    username: 'root',
    password: 'i5dAN0hN.HNAlWaYtS.'
});
