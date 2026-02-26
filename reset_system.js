const { Client } = require('pg');

async function resetDB() {
    // Configurações unificadas
    const config = {
        user: 'postgres',
        host: 'localhost',
        database: 'poisson_erp',
        password: 'ylrad320@',
        port: 5432
    };

    const client = new Client(config);

    try {
        await client.connect();
        console.log('--- Iniciando Reset de Registros ---');

        // 1. Limpa a tabela de registros
        // Usamos TRUNCATE para maior eficiência se a tabela for grande, e CASCADE para garantir dependências.
        await client.query('TRUNCATE TABLE records RESTART IDENTITY CASCADE');

        console.log('Banco de dados RE-SETADO com sucesso!');
        console.log('Todos os livros e históricos foram removidos.');
        console.log('O próximo registro começará do ID I-001 (lógica do frontend).');

    } catch (err) {
        console.error('Erro no reset:', err);
    } finally {
        await client.end();
    }
}

resetDB();
