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

    if (!xmlContent || !login_id || !login_passwd) {
        return res.status(400).json({ message: 'xmlContent, login_id e login_passwd são obrigatórios.' });
    }

    try {
        // Crossref Deposit API usa multipart/form-data com um arquivo XML
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

        if (response.ok) {
            // Crossref retorna HTML/texto indicando sucesso ou falha
            const isSuccess = text.toLowerCase().includes('your file has been received') ||
                text.toLowerCase().includes('successfully') ||
                response.status === 200;

            if (isSuccess) {
                // Tenta extrair ID de submissão do HTML de resposta
                const idMatch = text.match(/submission_id[=:\s]+([a-zA-Z0-9_-]+)/i);
                const submission_id = idMatch ? idMatch[1] : `CR-${Date.now()}`;
                return res.json({ ok: true, submission_id, raw: text.slice(0, 500) });
            } else {
                return res.status(422).json({ message: 'Crossref rejeitou o depósito.', raw: text.slice(0, 1000) });
            }
        } else {
            return res.status(response.status).json({
                message: `Crossref retornou status ${response.status}`,
                raw: text.slice(0, 500)
            });
        }
    } catch (err) {
        console.error('[crossref/deposit] Erro:', err);
        return res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

module.exports = router;
