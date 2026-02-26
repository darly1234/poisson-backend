const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('Connected to VPS...');
    const script = `
echo "=== Apache Configs ==="
httpd -S
echo "=== Conf.d ==="
ls -la /etc/httpd/conf.d/
echo "=== Grep for individual ==="
grep -rn "individual" /etc/httpd/
echo "=== Grep for poisson ==="
grep -rn "poisson" /etc/httpd/
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('close', () => { console.log(out); conn.end(); })
            .on('data', data => out += data)
            .stderr.on('data', data => out += data);
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
