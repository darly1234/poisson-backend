const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    conn.exec('/usr/local/apps/apache2/bin/httpd -S | grep "individual" || echo "Not found in vhosts"', (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('close', () => { console.log(out.trim()); conn.end(); })
            .on('data', data => out += data)
            .stderr.on('data', data => out += data);
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
