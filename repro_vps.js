const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'poisson_erp',
    password: "ylrad320@",
    port: 5432,
});

const { encrypt } = require('./src/utils/crypto');

async function test() {
    const key = 'test_repro_key';
    const value = { test: 'data', timestamp: new Date().toISOString() };
    
    try {
        const stringValue = (typeof value === 'object') ? JSON.stringify(value) : String(value);
        const encryptedValue = { encrypted: encrypt(stringValue) };

        console.log('Inserting key:', key);
        console.log('Value to insert (object):', encryptedValue);

        // Test 1: Literal object (current code)
        console.log('--- Test 1: Literal object ---');
        try {
            await pool.query(
                "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
                [key + '_1', encryptedValue]
            );
            console.log('Test 1 Success!');
        } catch (e) {
            console.error('Test 1 Failed:', e.message);
            console.error('Stack:', e.stack);
            if (e.detail) console.error('Detail:', e.detail);
            if (e.where) console.error('Where:', e.where);
        }

        // Test 2: Explicit stringify
        console.log('--- Test 2: Explicit stringify ---');
        try {
            await pool.query(
                "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
                [key + '_2', JSON.stringify(encryptedValue)]
            );
            console.log('Test 2 Success!');
        } catch (e) {
            console.error('Test 2 Failed:', e.message);
        }

    } catch (err) {
        console.error('Unexpected Error:', err);
    } finally {
        await pool.end();
    }
}

test();
