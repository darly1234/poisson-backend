const { Client } = require('ssh2');

const conn = new Client();

function runCmd(conn, cmd) {
    return new Promise((resolve, reject) => {
        console.log(`> Executando: ${cmd}`);
        conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            stream
                .on('data', d => process.stdout.write(d.toString()))
                .on('close', code => resolve(code));
        });
    });
}

conn.on('ready', async () => {
    console.log('Conectado à VPS');
    await runCmd(conn, 'pm2 logs poisson-api --lines 100 --nostream');
    await runCmd(conn, 'ls -la /home/darly/livros.poisson.com.br/adm/');
    conn.end();
}).on('error', e => console.error('SSH Error:', e))
    .connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
