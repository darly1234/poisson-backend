const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    conn.exec('curl -I http://127.0.0.1 -H "Host: individual.poisson.com.br" && curl -s http://127.0.0.1 -H "Host: individual.poisson.com.br" | grep -o "<title>.*</title>"', (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('close', () => { console.log(out.trim()); conn.end(); })
            .on('data', data => out += data)
            .stderr.on('data', data => out += data);
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
