const { Client } = require('pg');
require('dotenv').config();

async function check() {
    const client = new Client({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
    });

    try {
        await client.connect();
        const res = await client.query("SELECT key, value FROM settings WHERE key = 'n8n_webhook_url';");
        console.log('--- Settings ---');
        console.log(JSON.stringify(res.rows, null, 2));

        const logs = await client.query("SELECT * FROM message_logs ORDER BY sent_at DESC LIMIT 5;");
        console.log('--- Recent Logs ---');
        console.log(JSON.stringify(logs.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

check();
