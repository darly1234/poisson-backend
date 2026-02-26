const { Client } = require('ssh2');

const conn = new Client();

const localMetadata = { "tabs": [{ "id": "t_fluxo", "icon": "ListOrdered", "rows": [[{ "cellId": "cell-migrated-1", "colSpan": 6, "fieldId": "f_flow" }, { "cellId": "cell-cover-1771949378476", "colSpan": 6, "fieldId": "f_cover" }], [{ "cellId": "cell-migrated-2", "colSpan": 12, "fieldId": "f_workflow_timeline" }]], "label": "Fluxo" }, { "id": "t3", "icon": "t3", "rows": [[{ "cellId": "cell-fin-cat-1771948846087", "colSpan": 4, "fieldId": "f_client_cat" }, { "cellId": "cell-1771978066326-kw319s4", "colSpan": 8, "fieldId": "f_negotiators" }], [{ "cellId": "cell-1771977999493-oc8p714", "colSpan": 4, "fieldId": "f_total" }, { "cellId": "cell-1771978014760-r7i6agh", "colSpan": 4, "fieldId": "f_payment_method" }, { "cellId": "cell-1771978085656-crrjom4", "colSpan": 4, "fieldId": "f_payment_status" }], [{ "cellId": "cell-migrated-1771940874501-rjunjr1", "colSpan": 3, "fieldId": "f_commission" }, { "cellId": "cell-1771978125937-fueci0r", "colSpan": 3, "fieldId": "f_comm_status" }, { "cellId": "cell-1771978132811-xjtdxo9", "colSpan": 3, "fieldId": "f_comm_date" }, { "cellId": "cell-1771978138690-ugokdpo", "colSpan": 3, "fieldId": "f_comm_receipt" }], [{ "cellId": "cell-fin-obs-1771948561079", "colSpan": 12, "fieldId": "f_obs" }]], "label": "Financeiro" }], "fieldbank": [{ "id": "f_title", "isBI": true, "type": "text", "label": "Título da Obra", "isVisible": true }, { "id": "f_doi", "isBI": false, "type": "doi", "label": "DOI", "isVisible": true }, { "id": "f_isbn", "isBI": true, "type": "isbn", "label": "ISBN", "isVisible": true }, { "id": "f_authors", "isBI": false, "type": "authors", "label": "Autores/Organizadores", "isVisible": true }, { "id": "f_flow", "isBI": true, "type": "select", "label": "Status do Fluxo", "options": ["Para Editar", "Conferência", "Enviar Prova", "Avaliação Autor", "Alterações", "Para Publicar", "Publicado"], "isVisible": true }, { "id": "f_payment_method", "isBI": true, "type": "select", "label": "Forma de Pagamento", "options": ["À vista", "Parcelado", "Cortesia", "Permuta"], "isVisible": true }, { "id": "f_payment_status", "isBI": true, "type": "payment_status", "label": "Status do Pagamento", "isVisible": true }, { "id": "f_total", "isBI": true, "type": "currency", "label": "Valor Total do Livro", "isVisible": true }, { "id": "f_commission", "isBI": true, "type": "currency", "label": "Valor da Comissão", "isVisible": true }, { "id": "f_comm_status", "isBI": true, "type": "select", "label": "Status Pgto Comissão", "options": ["Pendente", "Pago"], "isVisible": true }, { "id": "f_comm_date", "isBI": false, "type": "text", "label": "Data Pgto Comissão", "isVisible": true }, { "id": "f_comm_receipt", "isBI": false, "type": "file", "label": "Comprovante de Pgto Comissão", "isVisible": true }, { "id": "f_client_cat", "isBI": true, "type": "select", "label": "Categoria do Cliente", "options": ["Poisson", "Fametro", "UFAM", "Santa Tereza"], "isVisible": true }, { "id": "f_obs", "isBI": false, "type": "long_text", "label": "Observações Gerais", "isVisible": true }, { "id": "f_workflow_timeline", "isBI": false, "type": "workflow", "label": "Linha do Tempo Editorial", "isVisible": true }, { "id": "f_negotiators", "isBI": false, "type": "negotiator", "label": "Negociadores", "isVisible": true }, { "id": "f_cover", "isBI": false, "type": "cover", "label": "Capa da Obra (Frente/Fundo)", "isVisible": true }] };

conn.on('ready', () => {
    const vpsScript = `
const pool = require('./src/db');
const metadata = ${JSON.stringify(localMetadata)};

async function sync() {
    try {
        const existing = await pool.query('SELECT id FROM metadata LIMIT 1');
        const tabs = JSON.stringify(metadata.tabs);
        const fieldBank = JSON.stringify(metadata.fieldbank);

        if (existing.rows.length === 0) {
            await pool.query('INSERT INTO metadata (tabs, fieldBank) VALUES ($1, $2)', [tabs, fieldBank]);
        } else {
            await pool.query('UPDATE metadata SET tabs = $1, fieldBank = $2, updated_at = NOW() WHERE id = $3', [tabs, fieldBank, existing.rows[0].id]);
        }
        console.log('SYNC_SUCCESS');
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
sync();
`;
    // Escapar o script para o bash
    const escapedScript = vpsScript.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');

    conn.exec(`echo "${escapedScript}" > /var/www/poisson-backend/sync_meta.js && cd /var/www/poisson-backend && node sync_meta.js && rm sync_meta.js`, (err, stream) => {
        if (err) throw err;
        stream.on('close', (code, signal) => {
            conn.end();
        }).on('data', (data) => {
            console.log('STDOUT: ' + data);
        }).stderr.on('data', (data) => {
            console.log('STDERR: ' + data);
        });
    });
}).connect({
    host: '72.60.254.10',
    port: 22,
    username: 'root',
    password: 'i5dAN0hN.HNAlWaYtS.'
});
