const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('Connected to VPS...');
    const script = `
echo "=================================="
echo "Atualizando Backend..."
echo "=================================="
cd /var/www/poisson-backend || exit
git stash
git pull origin main
npm install
pm2 restart poisson-api

echo " "
echo "=================================="
echo "Atualizando Frontend (ERP)..."
echo "=================================="
cd /var/www/poisson-erp || exit
git stash
git pull origin main
npm install
npm run build

echo " "
echo "=================================="
echo "Reiniciando Servidor Web Apache..."
echo "=================================="
systemctl restart httpd

echo " "
echo "=================================="
echo "=== Atualizacao na VPS concluida com SUCESSO! ==="
echo "=================================="
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
            .on('data', data => process.stdout.write(data))
            .stderr.on('data', data => process.stderr.write(data));
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
