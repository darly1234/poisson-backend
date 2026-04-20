const pool = require('./db');

const migrate = async () => {
    try {
        console.log('--- Iniciando Migração Slack ---');
        
        // 1. Tabela de Canais / Destinatários
        await pool.query(`
            CREATE TABLE IF NOT EXISTS canais_notificacao (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                slack_id TEXT NOT NULL UNIQUE,
                tipo TEXT
            )
        `);
        console.log('✓ Tabela canais_notificacao OK');

        // 2. Tabela de Mensagens Enviadas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificacoes_slack (
                id SERIAL PRIMARY KEY,
                record_id TEXT,
                id_grupo TEXT,
                usuario_destino TEXT,
                nome_destino TEXT,
                mensagem TEXT,
                status TEXT,
                data_envio TIMESTAMP DEFAULT NOW(),
                data_leitura TIMESTAMP
            )
        `);
        console.log('✓ Tabela notificacoes_slack OK');

        // 3. Inserir alguns destinatários de teste se a tabela estiver vazia
        const count = await pool.query("SELECT count(*) FROM canais_notificacao");
        if (parseInt(count.rows[0].count) === 0) {
            console.log('Populando destinatários iniciais...');
            await pool.query(`
                INSERT INTO canais_notificacao (nome, slack_id, tipo) VALUES 
                ('Darly - Poisson', 'U0123456789', 'user'),
                ('Equipe Editorial', 'C9876543210', 'channel')
            `);
            console.log('✓ Destinatários de teste inseridos.');
        }

        console.log('--- Migração Slack Concluída com Sucesso ---');
    } catch (err) {
        console.error('❌ ERRO NA MIGRAÇÃO:', err.message);
    } finally {
        process.exit();
    }
};

migrate();
