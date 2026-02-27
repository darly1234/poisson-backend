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

        // 3. Montar o payload final para o n8n
        // O servidor anexa os dados que ele julga importantes/seguros
        const payload = {
            recordId,
            templateName: templateName || 'Personalizada',
            message: message,
            recordDetails: recordData,
            timestamp: new Date().toISOString()
        };

        // 4. Disparar para o n8n
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const status = response.ok ? 'Sucesso' : 'Falha';
        let responseData = {};
        try { responseData = await response.json(); } catch (e) { }

        // 5. Registrar no log
        await pool.query(
            "INSERT INTO message_logs (record_id, template_name, message_content, status, response_data) VALUES ($1, $2, $3, $4, $5)",
            [recordId, templateName || 'Personalizada', message, status, JSON.stringify(responseData)]
        );

        if (response.ok) {
            res.json({ success: true, status });
        } else {
            res.status(response.status).json({ success: false, status, error: responseData });
        }

    } catch (err) {
        console.error('[Webhook Error]', err);
        res.status(500).json({ message: 'Erro interno ao processar o envio das mensagens.' });
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
        await pool.query(
            "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
            [key, value]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao salvar configuração.' });
    }
});

module.exports = router;
