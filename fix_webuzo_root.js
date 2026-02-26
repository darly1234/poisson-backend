const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    const script = `
mkdir -p /home/darly/individual
cp -a /var/www/poisson-erp/build/. /home/darly/individual/
chown -R darly:darly /home/darly/individual
systemctl restart httpd
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('close', () => { console.log("DONE"); console.log(out.trim()); conn.end(); })
            .on('data', data => out += data)
            .stderr.on('data', data => out += data);
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
