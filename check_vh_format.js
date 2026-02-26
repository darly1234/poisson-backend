const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    const script = `
grep -A 2 "<VirtualHost" /usr/local/apps/apache2/etc/conf.d/webuzoVH.conf | head -n 10
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('close', () => { console.log(out.trim()); conn.end(); })
            .on('data', data => out += data)
            .stderr.on('data', data => out += data);
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
