const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('Connected to VPS...');
    const script = `
echo "Unzipping build.zip..."
cd /var/www/poisson-erp
rm -rf build_old
mv build build_old
mkdir build
unzip -o build.zip -d build/
rm build.zip
echo "Restarting Apache..."
systemctl restart httpd
echo "Done!"
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
            .on('data', data => process.stdout.write(data))
            .stderr.on('data', data => process.stderr.write(data));
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
