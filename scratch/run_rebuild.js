const { Client } = require('ssh2');
const conn = new Client();

conn.on('ready', () => {
    console.log('Connected to VPS for Rebuild...');
    const script = `
echo "=================================="
echo "Iniciando Reconstrução de Artigos..."
echo "=================================="
cd /var/www/poisson-backend || exit
node rebuild_articles_vps.js
echo "=================================="
echo "Reconstrução concluída!"
echo "=================================="
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
            .on('data', data => process.stdout.write(data))
            .stderr.on('data', data => process.stderr.write(data));
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
