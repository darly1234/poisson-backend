const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    const vpsScript = 
const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'poisson_erp',
    user: 'postgres',
    password: 'ylrad320@',
});

async function repair() {
    try {
        console.log('Criando tabela filters na VPS...');
        await pool.query('CREATE TABLE IF NOT EXISTS filters (id VARCHAR(255) PRIMARY KEY, name VARCHAR(255), config JSONB, created_at TIMESTAMP DEFAULT NOW())');
        console.log('✅ Tabela filters criada com sucesso.');
    } catch (err) {
        console.error('❌ Erro no reparo:', err);
    } finally {
        await pool.end();
    }
}
repair();
;
    const escaped = vpsScript.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(//g, '\\').replace(/\$/g, '\\$');
    conn.exec('echo \"' + escaped + '\" > /var/www/poisson-backend/simple_repair.js && cd /var/www/poisson-backend && node simple_repair.js && rm simple_repair.js', (err, stream) => {
        let out = '';
        stream.on('close', () => {
            console.log(out.trim());
            conn.end();
        }).on('data', d => out += d).stderr.on('data', d => out += d);
    });
}).connect({
    host: '72.60.254.10',
    port: 22,
    username: 'root',
    password: 'i5dAN0hN.HNAlWaYtS.'
});
