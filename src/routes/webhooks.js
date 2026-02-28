const express = require('express');
const router = express.Router();
const pool = require('../db');
const fetch = require('node-fetch');

// ── Mensagens / Envio ─────────────────────────────────────────────────────────

router.post('/send', async (req, res) => {
    const { recordId, message, templateName } = req.body;

    if (!recordId || !message) {
        return res.status(400).json({ message: 'RecordID e Mensagem são obrigatórios.' });
    }

    try {
        // 1. Buscar a URL do Webhook do n8n nas configurações
        const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'n8n_webhook_url'");
        const webhookUrl = settingsRes.rows[0]?.value?.url;

        if (!webhookUrl) {
            return res.status(500).json({ message: 'URL do Webhook do n8n não configurada.' });
        }

        // 2. Buscar dados do registro para o payload (e para segurança do negociador)
        const recordRes = await pool.query("SELECT data FROM records WHERE id = $1", [recordId]);
        if (recordRes.rows.length === 0) {
            return res.status(404).json({ message: 'Registro não encontrado.' });
        }

        const recordData = recordRes.rows[0].data || {};

        // Extrair informações do negociador (campo f_negotiators)
        const negotiators = Array.isArray(recordData.f_negotiators) ? recordData.f_negotiators : [];
        const firstNegotiator = negotiators[0] || {};
        const negotiatorEmail = firstNegotiator.email || '';
        const negotiatorPhoneRaw = firstNegotiator.telefone || '';
        const negotiatorPhoneClean = negotiatorPhoneRaw.replace(/\D/g, ''); // Apenas números

        // 3. Montar o payload final para o n8n
        const payload = {
            recordId,
            templateName: templateName || 'Personalizada',
            message: message,
            recordDetails: recordData,
            negociador_nome: firstNegotiator.nome || '',
            negociador: {
                nome: firstNegotiator.nome || '',
                email: negotiatorEmail,
                telefone: negotiatorPhoneClean
            },
            timestamp: new Date().toISOString()
        };

        // 4. Disparar para o n8n
        console.log('[n8n] Enviando para URL:', webhookUrl);
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const status = response.ok ? 'Sucesso' : 'Falha';
        let responseData = {};
        try { responseData = await response.json(); } catch (e) {
            console.warn('[n8n] Resposta não é JSON');
        }

        // 5. Registrar no log
        await pool.query(
            "INSERT INTO message_logs (record_id, template_name, message_content, status, response_data) VALUES ($1, $2, $3, $4, $5)",
            [recordId, templateName || 'Personalizada', message, status, JSON.stringify(responseData)]
        );

        if (response.ok) {
            res.json({ success: true, status });
        } else {
            console.error('[n8n] Erro no n8n:', response.status, responseData);
            res.status(response.status).json({ success: false, status, error: responseData });
        }

    } catch (err) {
        console.error('[Webhook Error Detail]', err);
        res.status(500).json({ message: 'Erro interno ao processar o envio das mensagens.', details: err.message });
    }
});

// ── Histórico ─────────────────────────────────────────────────────────────────

router.get('/history/:recordId', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, template_name, status, sent_at, message_content FROM message_logs WHERE record_id = $1 ORDER BY sent_at DESC",
            [req.params.recordId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar histórico.' });
    }
});

// Deletar log de histórico
router.delete('/history/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM message_logs WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('[History Delete Error]', err);
        res.status(500).json({ message: 'Erro ao deletar histórico.' });
    }
});

// ── Configurações (Templates e Webhook) ───────────────────────────────────────

router.get('/settings', async (req, res) => {
    try {
        const result = await pool.query("SELECT key, value FROM settings");
        const settings = {};
        result.rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar configurações.' });
    }
});

router.post('/settings', async (req, res) => {
    const { key, value } = req.body;
    try {
        // Garantir que o valor seja salvo como JSON string se for objeto
        const dbValue = (typeof value === 'object') ? JSON.stringify(value) : value;

        await pool.query(
            "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
            [key, dbValue]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[Settings Error]', err);
        res.status(500).json({ message: 'Erro ao salvar configuração: ' + err.message });
    }
});

module.exports = router;
