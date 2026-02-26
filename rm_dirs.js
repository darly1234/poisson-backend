const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('Connected');
    conn.exec(`rm -rf /home/darly/individual /home/darly/individual.poisson.com.br`, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
            .on('data', data => process.stdout.write('OUT: ' + data))
            .stderr.on('data', data => process.stderr.write('ERR: ' + data));
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
