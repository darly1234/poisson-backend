const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();

const UPLOADS = [
    { local: 'C:/poisson-backend/src/routes/ai.js', remote: '/var/www/poisson-backend/src/routes/ai.js' }
];

function uploadFile(sftp, localPath, remotePath) {
    return new Promise((resolve, reject) => {
        const content = fs.readFileSync(localPath, 'utf8');
        const buf = Buffer.from(content, 'utf8');
        sftp.open(remotePath, 'w', (err, handle) => {
            if (err) return reject(err);
            sftp.write(handle, buf, 0, buf.length, 0, (err2) => {
                if (err2) { sftp.close(handle, () => { }); return reject(err2); }
                sftp.close(handle, (err3) => {
                    if (err3) return reject(err3);
                    console.log('✅ Enviado: ' + remotePath);
                    resolve();
                });
            });
        });
    });
}

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
    conn.sftp(async (err, sftp) => {
        if (err) { console.error(err); conn.end(); return; }

        for (const file of UPLOADS) {
            try {
                await uploadFile(sftp, file.local, file.remote);
            } catch (e) {
                console.error('❌ Erro em ' + file.local + ':', e.message);
            }
        }

        console.log('\nReiniciando Backend...');
        await runCmd(conn, 'pm2 restart poisson-api');

        console.log('\nTodos os comandos concluídos!');
        conn.end();
    });
}).on('error', e => console.error('SSH Error:', e))
    .connect({ host: '72.60.254.10', port: 22, username: 'root', password: 'i5dAN0hN.HNAlWaYtS.' });
