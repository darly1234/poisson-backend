const pool = require('./src/db');

async function migrate() {
    try {
        console.log('--- Iniciando Migração de Tipo de ID (message_logs) ---');

        // Alterar record_id de INTEGER para VARCHAR(255)
        // Usamos USING record_id::text para converter os dados existentes
        await pool.query(`
            ALTER TABLE message_logs 
            ALTER COLUMN record_id TYPE VARCHAR(255) USING record_id::text;
        `);

        console.log('✓ Coluna "record_id" alterada para VARCHAR(255) com sucesso.');
        process.exit(0);
    } catch (err) {
        console.error('Erro na migração:', err);
        process.exit(1);
    }
}

migrate();
