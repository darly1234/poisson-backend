const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const conn = new Client();

const syncList = [
    { local: 'c:/poisson-backend/server.js', remote: '/var/www/poisson-backend/server.js' }
];

conn.on('ready', () => {
    console.log('SSH Connection Ready for Hotfix');
    conn.sftp((err, sftp) => {
        if (err) throw err;

        let syncIndex = 0;
        function uploadNext() {
            if (syncIndex >= syncList.length) {
                console.log('Files uploaded.');
                runCommands();
                return;
            }
            const item = syncList[syncIndex];
            sftp.fastPut(item.local, item.remote, (err) => {
                if (err) throw err;
                console.log(`✓ ${path.basename(item.local)} synced.`);
                syncIndex++;
                uploadNext();
            });
        }

        function runCommands() {
            conn.exec('pm2 restart poisson-api', (err, stream) => {
                if (err) throw err;
                stream.on('close', () => {
                    console.log('API Restarted successfully.');
                    conn.end();
                }).on('data', (data) => {
                    process.stdout.write(data);
                });
            });
        }
        uploadNext();
    });
}).connect({
    host: '72.60.254.10',
    port: 22,
    username: 'root',
    password: 'i5dAN0hN.HNAlWaYtS.'
});
