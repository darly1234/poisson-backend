const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('Connected to VPS...');
    conn.exec('grep "DB_" /home/darly/poisson.com.br/wp-config.php', (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
            .on('data', data => process.stdout.write(data))
            .stderr.on('data', data => process.stderr.write(data));
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
