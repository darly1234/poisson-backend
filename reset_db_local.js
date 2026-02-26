const { Client } = require('pg');

async function resetDB() {
    const client = new Client({
        user: 'postgres',
        host: 'localhost',
        database: 'poisson_erp',
        password: 'ylrad320@',
        port: 5432
    });

    try {
        await client.connect();
        console.log('--- Iniciando Reset de Registros ---');

        // Limpa a tabela de registros
        await client.query('DELETE FROM records');

        console.log('Banco de dados local RE-SETADO com sucesso!');
        console.log('Todos os livros foram removidos. O próximo ID será I-001 (lógica do frontend).');

    } catch (err) {
        console.error('Erro no reset:', err);
    } finally {
        await client.end();
    }
}

resetDB();
