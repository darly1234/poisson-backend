const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    conn.exec("export PGPASSWORD='ylrad320@'; psql -U postgres -d poisson_erp -c '\\dt'", (err, stream) => {
        let out = '';
        stream.on('close', () => {
            console.log(out.trim());
            conn.end();
        }).on('data', d => out += d).stderr.on('data', d => out += d);
    });
}).connect({
    host: '72.60.254.10',
    port: 22,
    username: 'root',
    password: 'i5dAN0hN.HNAlWaYtS.'
});
