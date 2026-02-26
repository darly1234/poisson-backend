const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'poisson_erp',
    password: 'ylrad320@',
    port: 5432,
});

async function dumpMetadata() {
    try {
        const res = await pool.query('SELECT tabs, fieldBank FROM metadata ORDER BY id DESC LIMIT 1');
        if (res.rows.length > 0) {
            console.log(JSON.stringify(res.rows[0]));
        } else {
            console.log("null");
        }
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

dumpMetadata();
