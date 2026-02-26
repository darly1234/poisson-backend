const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    const script = `
echo "=== ERP ==="
cd /var/www/poisson-erp
git log -n 3 --oneline
echo "=== BACKEND ==="
cd /var/www/poisson-backend
git log -n 3 --oneline
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('close', () => { console.log(out.trim()); conn.end(); })
            .on('data', data => out += data)
            .stderr.on('data', data => out += data);
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
