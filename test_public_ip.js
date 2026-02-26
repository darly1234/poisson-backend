const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    const script = `
curl -s -k -v --resolve individual.poisson.com.br:443:72.60.254.10 https://individual.poisson.com.br/
`;
    conn.exec(script, (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('close', () => { console.log(out.trim()); conn.end(); })
            .on('data', data => out += data)
            .stderr.on('data', data => out += data);
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
