const { Client } = require('ssh2');

const conn = new Client();

conn.on('ready', () => {
    const envContent = `PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=poisson_erp
DB_USER=postgres
DB_PASS=ylrad320@

# VPS SSH - Gerenciador de Arquivos
VPS_SSH_HOST=72.60.254.10
VPS_SSH_PORT=22
VPS_SSH_USER=root
VPS_SSH_PASSWORD=i5dAN0hN.HNAlWaYtS.
VPS_FILES_BASE=/home/darly/livros.poisson.com.br`;

    const script = `
echo "${envContent}" > /var/www/poisson-backend/.env
pm2 restart poisson-backend
`;

    conn.exec(script, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => {
            console.log('VPS_ENV_FIXED');
            conn.end();
        }).on('data', d => console.log(d.toString()));
    });
}).connect({
    host: '72.60.254.10',
    port: 22,
    username: 'root',
    password: 'i5dAN0hN.HNAlWaYtS.'
});
