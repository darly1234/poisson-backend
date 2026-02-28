const pool = require('./src/db');

async function setup() {
    try {
        console.log('--- Iniciando Setup do Banco de Dados (Mensagens e n8n) ---');

        // 1. Tabela settings
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(255) PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ Tabela "settings" verificada/criada.');

        // 2. Tabela message_logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS message_logs (
                id SERIAL PRIMARY KEY,
                record_id VARCHAR(255) NOT NULL,
                template_name VARCHAR(255),
                message_content TEXT,
                status VARCHAR(50),
                response_data JSONB,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ Tabela "message_logs" verificada/criada.');

        // 3. Inserir configurações iniciais vazias se não existirem
        const initialSettings = [
            ['n8n_webhook_url', { url: '' }],
            ['message_templates', []],
            ['smtp_config', { host: '', port: '587', user: '', pass: '', from_name: 'Poisson ERP', from_email: '' }],
            ['system_templates', {
                password_reset: { subject: 'Redefinição de senha', content: 'Link: {{reset_url}}' },
                login_code: { subject: 'Código de acesso', content: 'Código: {{code}}' }
            }]
        ];

        for (const [key, val] of initialSettings) {
            await pool.query(
                "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
                [key, JSON.stringify(val)]
            );
        }
        console.log('✓ Configurações iniciais inseridas.');

        console.log('--- Setup concluído com sucesso! ---');
        process.exit(0);
    } catch (err) {
        console.error('Erro no setup:', err);
        process.exit(1);
    }
}

setup();
