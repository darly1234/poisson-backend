const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    const script = `
certbot --apache -d individual.poisson.com.br --non-interactive --agree-tos --register-unsafely-without-email || echo "Certbot failed?"
systemctl restart httpd
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('close', () => { console.log(out); conn.end(); })
            .on('data', data => out += data)
            .stderr.on('data', data => out += data);
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
