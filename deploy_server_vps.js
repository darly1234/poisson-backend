const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const LOCAL_SERVER_JS = path.join(__dirname, 'server.js');
const REMOTE_SERVER_JS = '/var/www/poisson-backend/server.js';

const conn = new Client();
conn.on('ready', () => {
    console.log('SSH conectado. Atualizando server.js do backend...');
    conn.sftp((err, sftp) => {
        if (err) { console.error(err); conn.end(); return; }
        sftp.fastPut(LOCAL_SERVER_JS, REMOTE_SERVER_JS, (err) => {
            if (err) { console.error('Erro upload server.js:', err); conn.end(); return; }
            console.log('server.js enviado. Reiniciando API...');
            conn.exec('pm2 restart poisson-backend', (err, stream) => {
                if (err) { console.error(err); conn.end(); return; }
                stream.on('data', d => process.stdout.write(String(d)));
                stream.stderr.on('data', d => process.stderr.write(String(d)));
                stream.on('close', (code) => {
                    console.log('API reiniciada, code:', code);
                    conn.end();
                });
            });
        });
    });
}).connect({
    host: '72.60.254.10',
    port: 22,
    username: 'root',
    password: 'i5dAN0hN.HNAlWaYtS.'
});
