require('dotenv').config({ path: __dirname + '/.env' });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
});

async function resetPassword() {
    try {
        const password = 'Admin@123';
        const hash = await bcrypt.hash(password, 10);

        // Check if user exists
        const existing = await pool.query(
            'SELECT id, email, role, email_verified FROM users WHERE email = $1',
            ['admin@poisson.com.br']
        );

        if (!existing.rows.length) {
            // Create it
            await pool.query(
                'INSERT INTO users (name, email, password_hash, role, email_verified) VALUES ($1, $2, $3, $4, true)',
                ['Administrador', 'admin@poisson.com.br', hash, 'admin']
            );
            console.log('Usuário admin criado com sucesso!');
        } else {
            // Reset password
            await pool.query(
                'UPDATE users SET password_hash = $1, email_verified = true WHERE email = $2',
                [hash, 'admin@poisson.com.br']
            );
            console.log('Senha redefinida com sucesso!');
            console.log('User:', existing.rows[0]);
        }

        // Verify the hash works
        const check = await pool.query(
            'SELECT password_hash FROM users WHERE email = $1',
            ['admin@poisson.com.br']
        );
        const valid = await bcrypt.compare(password, check.rows[0].password_hash);
        console.log('Hash validation:', valid ? 'OK' : 'FAILED');

        console.log('\nEmail: admin@poisson.com.br');
        console.log('Senha: Admin@123');
        process.exit(0);
    } catch (err) {
        console.error('Erro:', err.message);
        process.exit(1);
    }
}

resetPassword();
