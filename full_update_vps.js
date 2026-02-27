const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('SSH Ready. Updating Backend and Frontend on VPS...');
    // Executa os comandos do atualizar-vps.sh
    const commands = [
        "cd /var/www/poisson-backend && git stash && git pull origin main && npm install && pm2 restart poisson-api",
        "cd /var/www/poisson-erp && git stash && git pull origin main && npm install && npm run build",
        "systemctl restart httpd"
    ].join(' && ');

    conn.exec(commands, (err, stream) => {
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
