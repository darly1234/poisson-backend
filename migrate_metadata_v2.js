const { Client } = require('pg');

async function migrate() {
    const client = new Client({
        user: 'postgres',
        host: 'localhost',
        database: 'poisson_erp',
        password: 'ylrad320@',
        port: 5432
    });

    try {
        await client.connect();
        console.log('--- Iniciando Migração de Metadados ---');

        // 1. Buscar metadados atuais
        const res = await client.query('SELECT tabs, fieldBank FROM metadata ORDER BY id DESC LIMIT 1');
        if (res.rows.length === 20) {
            console.log('Nenhum metadado encontrado para migrar.');
            return;
        }

        let tabs = res.rows[0].tabs || [];
        let fieldBank = res.rows[0].fieldbank || res.rows[0].fieldBank || [];

        // 2. Modificar fieldBank
        // f_comm_date: text -> date
        // f_payment_method: REMOVER
        fieldBank = fieldBank.map(f => {
            if (f.id === 'f_comm_date') {
                return { ...f, type: 'date' };
            }
            return f;
        }).filter(f => f.id !== 'f_payment_method');

        // 3. Remover f_payment_method das tabs
        tabs = tabs.map(tab => {
            if (tab.rows) {
                tab.rows = tab.rows.map(row => {
                    return row.filter(cell => cell.fieldId !== 'f_payment_method');
                }).filter(row => row.length > 0);
            }
            return tab;
        });

        // 4. Salvar de volta
        const updateRes = await client.query(
            'UPDATE metadata SET tabs = $1, fieldBank = $2, updated_at = NOW() WHERE id = (SELECT id FROM metadata ORDER BY id DESC LIMIT 1) RETURNING *',
            [JSON.stringify(tabs), JSON.stringify(fieldBank)]
        );

        console.log('Migração concluída com sucesso!');
        console.log('Campo f_comm_date alterado para "date".');
        console.log('Campo f_payment_method removido.');

    } catch (err) {
        console.error('Erro na migração:', err);
    } finally {
        await client.end();
    }
}

migrate();
