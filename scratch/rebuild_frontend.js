const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('Connected to VPS...');
    const script = `
echo "Cleaning up ERP directory..."
cd /var/www/poisson-erp
rm -rf node_modules package-lock.json
echo "Installing dependencies..."
npm install --legacy-peer-deps
echo "Building ERP..."
npm run build
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
            .on('data', data => process.stdout.write(data))
            .stderr.on('data', data => process.stderr.write(data));
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
