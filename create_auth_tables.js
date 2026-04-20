const { Pool } = require('pg');
require('dotenv').config({ path: 'C:/poisson-backend/.env' });

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
});

async function createAuthTables() {
    const client = await pool.connect();
    try {
        console.log('Conectando ao banco de dados...');
        await client.query('BEGIN');

        // Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT,
                role VARCHAR(50) DEFAULT 'user',
                otp_code VARCHAR(10),
                otp_expires TIMESTAMPTZ,
                reset_token TEXT,
                reset_token_expires TIMESTAMPTZ,
                email_verified BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Tabela users criada.');

        // Create refresh_tokens table
        await client.query(`
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Tabela refresh_tokens criada.');

        // Create settings table
        await client.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(255) PRIMARY KEY,
                value JSONB,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Tabela settings criada.');

        await client.query('COMMIT');

        // Seed admin user
        const bcrypt = require('bcrypt');
        const adminEmail = 'admin@poisson.com.br';
        const adminPass = 'Admin@123';
        const adminName = 'Administrador';
        const hash = await bcrypt.hash(adminPass, 12);

        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
        if (!existing.rows.length) {
            await pool.query(
                'INSERT INTO users (name, email, password_hash, role, email_verified) VALUES ($1, $2, $3, $4, true)',
                [adminName, adminEmail, hash, 'admin']
            );
            console.log(`\nUsuário admin criado!\nEmail: ${adminEmail}\nSenha: ${adminPass}`);
        } else {
            console.log(`\nUsuário admin já existe: ${adminEmail}`);
        }

        console.log('\nMigração concluída com sucesso!');
        process.exit(0);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migração falhou:', err.message);
        process.exit(1);
    } finally {
        client.release();
    }
}

createAuthTables();
