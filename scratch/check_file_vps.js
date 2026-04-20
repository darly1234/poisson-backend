const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('Connected to VPS...');
    conn.exec('node -e "const fs = require(\'fs\'); console.log(fs.existsSync(\'/home/darly/poisson.com.br/wp-content/uploads/gravity_forms/8-255da51fca272eec7e5b92f2df9c8265/2026/04/TCC_PLA_Jozilene-Aleixo-Guimaraes-Versao-Pre-Banca.pdf\'))"', (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
            .on('data', data => process.stdout.write(data))
            .stderr.on('data', data => process.stderr.write(data));
    });
}).connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
