#!/bin/bash
cat << 'EOF' > /var/www/poisson-backend/test_sftp_diagnostic.js
const SftpClient = require("ssh2-sftp-client");
const dotenv = require("dotenv");
dotenv.config();

async function run() {
    const sftp = new SftpClient();
    const config = {
        host: process.env.VPS_SSH_HOST || "127.0.0.1",
        port: 22,
        username: process.env.VPS_SSH_USER || "root",
        password: process.env.VPS_SSH_PASSWORD,
        readyTimeout: 10000,
    };
    console.log("Testing config:", { ...config, password: "***" });
    try {
        await sftp.connect(config);
        console.log("SFTP_SUCCESS");
        await sftp.end();
    } catch (err) {
        console.error("SFTP_ERROR:", err.message);
    }
}
run();
EOF
cd /var/www/poisson-backend && node test_sftp_diagnostic.js
