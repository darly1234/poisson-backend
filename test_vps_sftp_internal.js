const { Client } = require('ssh2');
const conn = new Client();

const testSftp = `
cat << 'EOF' > /tmp/test_sftp.js
const SftpClient = require('ssh2-sftp-client');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: '/var/www/poisson-backend/.env' });

async function run() {
    const sftp = new SftpClient();
    const config = {
        host: process.env.VPS_SSH_HOST,
        port: parseInt(process.env.VPS_SSH_PORT || '22'),
        username: process.env.VPS_SSH_USER,
        password: process.env.VPS_SSH_PASSWORD,
        readyTimeout: 10000,
    };
    console.log('Testing with config:', { ...config, password: '***' });
    try {
        await sftp.connect(config);
        console.log('SFTP_SUCCESS');
        const list = await sftp.list(process.env.VPS_FILES_BASE || '/');
        console.log('LIST_SUCCESS, items:', list.length);
        await sftp.end();
    } catch (err) {
        console.error('SFTP_ERROR:', err.message);
    }
}
run();
EOF
cd /var/www/poisson-backend && node /tmp/test_sftp.js
`;

conn.on('ready', () => {
    conn.exec(testSftp, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
            .on('data', d => process.stdout.write(d))
            .stderr.on('data', d => process.stderr.write(d));
    });
}).connect({
    host: '72.60.254.10',
    port: 22,
    username: 'root',
    password: 'i5dAN0hN.HNAlWaYtS.'
});
