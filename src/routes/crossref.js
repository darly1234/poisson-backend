const express = require('express');
const router = express.Router();
const FormData = require('form-data');
const fetch = require('node-fetch');

const CROSSREF_DEPOSIT_URL = 'https://doi.crossref.org/servlet/deposit';

/**
 * POST /api/crossref/deposit
 * Faz o depósito do XML no serviço da Crossref via multipart/form-data.
 * Body: { xmlContent: string, login_id: string, login_passwd: string }
 */
router.post('/deposit', async (req, res) => {
    const { xmlContent, login_id, login_passwd } = req.body;
    console.log(`[Crossref] Recebido pedido de depósito. XML length: ${xmlContent?.length || 0}`);

    if (!xmlContent || !login_id || !login_passwd) {
        console.warn('[Crossref] Falha: Dados incompletos facilitados.');
        return res.status(400).json({ message: 'xmlContent, login_id e login_passwd são obrigatórios.' });
    }

    try {
        console.log(`[Crossref] Enviando para Crossref URL: ${CROSSREF_DEPOSIT_URL} com login: ${login_id}`);
        const form = new FormData();
        form.append('operation', 'doMDUpload');
        form.append('login_id', login_id);
        form.append('login_passwd', login_passwd);
        form.append('fname', Buffer.from(xmlContent, 'utf-8'), {
            filename: 'deposit.xml',
            contentType: 'application/xml',
        });

        const response = await fetch(CROSSREF_DEPOSIT_URL, {
            method: 'POST',
            body: form,
            headers: form.getHeaders(),
        });

        const text = await response.text();
        console.log(`[Crossref] Resposta recebida. Status: ${response.status}. Corpo (truncado): ${text.slice(0, 100)}`);

        if (response.ok) {
            const isSuccess = text.toLowerCase().includes('your file has been received') ||
                text.toLowerCase().includes('successfully') ||
                response.status === 200;

            if (isSuccess) {
                const idMatch = text.match(/submission_id[=:\s]+([a-zA-Z0-9_-]+)/i);
                const submission_id = idMatch ? idMatch[1] : `CR-${Date.now()}`;
                console.log(`[Crossref] Sucesso! Submission ID: ${submission_id}`);
                return res.json({ ok: true, submission_id, raw: text.slice(0, 500) });
            } else {
                console.error('[Crossref] Rejeitado pela Crossref:', text);
                return res.status(422).json({ message: 'Crossref rejeitou o depósito.', raw: text.slice(0, 1000) });
            }
        } else {
            console.error(`[Crossref] Erro HTTP ${response.status}:`, text);
            return res.status(response.status).json({
                message: `Crossref retornou status ${response.status}`,
                raw: text.slice(0, 500)
            });
        }
    } catch (err) {
        console.error('[crossref/deposit] Erro Fatal:', err);
        return res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

module.exports = router;
