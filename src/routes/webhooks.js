const express = require('express');
const router = express.Router();
const pool = require('../db');
const fetch = require('node-fetch');
// const sharp = require('sharp'); // Removido do topo para evitar erro se não estiver instalado
const { encrypt, decrypt } = require('../utils/crypto');
const fs = require('fs');
const path = require('path');

// ── Mensagens / Envio ─────────────────────────────────────────────────────────

router.post('/send', async (req, res) => {
    const { recordId, subject, message, templateName } = req.body;

    if (!recordId || !message) {
        return res.status(400).json({ message: 'RecordID e Mensagem são obrigatórios.' });
    }

    try {
        // 1. Buscar a URL do Webhook do n8n nas configurações
        const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'n8n_webhook_url'");
        let webhookUrlRaw = settingsRes.rows[0]?.value;
        
        // Descriptografar se necessário
        if (typeof webhookUrlRaw === 'string' && webhookUrlRaw.includes(':')) {
            try {
                const decrypted = decrypt(webhookUrlRaw);
                try {
                    webhookUrlRaw = JSON.parse(decrypted);
                } catch (e) {
                    webhookUrlRaw = decrypted;
                }
            } catch (e) {
                // Se falhar a descriptografia, mantém original
            }
        }
        
        const webhookUrl = webhookUrlRaw?.url;

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

        const payload = {
            subject: subject,
            message: message,
            email: negotiatorEmail,
            telefone: negotiatorPhoneClean
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
            [recordId, templateName || 'Personalizada', `[Assunto: ${subject || 'Sem Assunto'}]\n\n${message}`, status, JSON.stringify(responseData)]
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
        result.rows.forEach(r => {
            let val = r.value;
            
            // Se veio do banco como string (coluna TEXT), tenta converter para objeto
            if (typeof val === 'string' && val.trim().startsWith('{')) {
                try { val = JSON.parse(val); } catch(e) {}
            }

            // Suporte ao novo formato { encrypted: "iv:content" }
            if (val && typeof val === 'object' && val.encrypted) {
                val = val.encrypted;
            }

            // Descriptografia automática se for string com padrão IV (iv:content)
            if (typeof val === 'string' && val.includes(':')) {
                try {
                    const decrypted = decrypt(val);
                    // Tenta converter de volta para objeto se era JSON
                    try {
                        val = JSON.parse(decrypted);
                    } catch (e) {
                        val = decrypted;
                    }
                } catch (e) {
                    // Mantém original se falhar
                }
            }
            settings[r.key] = val;
        });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar configurações.' });
    }
});

router.post('/settings', async (req, res) => {
    const { key, value } = req.body;
    try {
        // Garantir que o valor seja salvo como JSON string se for objeto
        const stringValue = (typeof value === 'object') ? JSON.stringify(value) : String(value);
        
        // Encriptação "FBI Style" ativa para TODOS os campos
        // Salvamos como OBJETO para garantir compatibilidade com o tipo JSONB do Postgres
        const encryptedValue = { encrypted: encrypt(stringValue) };

        await pool.query(
            "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
            [key, encryptedValue]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[Settings Error]', err);
        res.status(500).json({ message: 'Erro ao salvar configuração: ' + err.message });
    }
});

// ── Preparar Postagem (Ponte ERP -> n8n) ──────────────────────────────────────

router.post('/preparar-postagem', async (req, res) => {
    const { imagem_base64, media_url, media_type, descricao, redes } = req.body;
    console.log('[Postagem] Recebendo solicitação para redes:', redes);

    if (!imagem_base64 && !media_url) {
        console.error('[Postagem] Erro: Imagem base64 ou media_url é obrigatório');
        return res.status(400).json({ message: 'Mídia é obrigatória.' });
    }

    try {
        let publicUrl = media_url;
        let finalMediaType = media_type || 'image';

        // 1. Processar Base64 se não tiver link direto (legado ou novas edições em canvas)
        if (!media_url && imagem_base64) {
            const ANEXOS_PATH = process.platform === 'win32'
                ? 'C:\\projeto_poisson_erp\\temp_posts'
                : '/home/darly/projeto_poisson_erp/temp_posts';
            
            if (!fs.existsSync(ANEXOS_PATH)) {
                console.log('[Postagem] Criando diretório:', ANEXOS_PATH);
                fs.mkdirSync(ANEXOS_PATH, { recursive: true });
            }

            const filename = `post_${Date.now()}.jpg`;
            const filePath = path.join(ANEXOS_PATH, filename);
            const base64Data = imagem_base64.replace(/^data:image\/\w+;base64,/, "");
            const inputBuffer = Buffer.from(base64Data, 'base64');
            
            let sharp;
            try { sharp = require('sharp'); } catch (e) { console.error('[Postagem] Erro ao carregar sharp:', e.message); }

            if (!sharp) {
                fs.writeFileSync(filePath, inputBuffer);
                console.log('[Postagem] Sharp ausente. Imagem salva sem processamento:', filePath);
            } else {
                let sharpInstance = sharp(inputBuffer);
                const metadata = await sharpInstance.metadata();
                const hasFeed = redes.some(r => r.includes('feed'));
                const hasStory = redes.some(r => r.includes('story'));
                const ratio = metadata.width / metadata.height;
                
                if (hasFeed) {
                    if (ratio < 0.8) {
                        const targetWidth = Math.round(metadata.height * 0.8);
                        sharpInstance = sharpInstance.extend({
                            top: 0, bottom: 0, left: Math.round((targetWidth - metadata.width) / 2), right: Math.round((targetWidth - metadata.width) / 2), background: { r: 255, g: 255, b: 255, alpha: 1 }
                        });
                    } else if (ratio > 1.91) {
                        const targetHeight = Math.round(metadata.width / 1.91);
                        sharpInstance = sharpInstance.extend({
                            left: 0, right: 0, top: Math.round((targetHeight - metadata.height) / 2), bottom: Math.round((targetHeight - metadata.height) / 2), background: { r: 255, g: 255, b: 255, alpha: 1 }
                        });
                    }
                } else if (hasStory && !hasFeed) {
                    if (Math.abs(ratio - 0.5625) > 0.05) {
                        const targetWidth = Math.round(metadata.height * 0.5625);
                        if (targetWidth > metadata.width) {
                            sharpInstance = sharpInstance.extend({
                                top: 0, bottom: 0, left: Math.round((targetWidth - metadata.width) / 2), right: Math.round((targetWidth - metadata.width) / 2), background: { r: 255, g: 255, b: 255, alpha: 1 }
                            });
                        }
                    }
                }
                
                await sharpInstance.jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(filePath);
            }

            try { fs.chmodSync(filePath, 0o755); } catch(e) {}
            console.log('[Postagem] Arquivo processado e salvo em:', filePath);
            
            const baseUrl = process.env.ANEXOS_BASE_URL || 'https://poisson.com.br/api/anexos';
            publicUrl = `${baseUrl}/temp_posts/${filename}`;
            console.log('[Postagem] URL pública gerada:', publicUrl);
        }

        // 4. Buscar Webhook n8n nas configurações
        const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'n8n_webhook_url'");
        let webhookUrlRaw = settingsRes.rows[0]?.value;
        if (typeof webhookUrlRaw === 'object' && webhookUrlRaw.encrypted) {
            webhookUrlRaw = decrypt(webhookUrlRaw.encrypted);
            try { webhookUrlRaw = JSON.parse(webhookUrlRaw); } catch(e) {}
        }
        
        const webhookUrl = webhookUrlRaw?.url || 'https://n8.poisson.com.br/webhook/erp-publicar-redes';
        console.log('[Postagem] Enviando para n8n:', webhookUrl);

        // 5. Enviar para n8n
        const n8nPayload = {
            imagem_url: publicUrl,
            media_url: publicUrl,
            media_type: finalMediaType,
            descricao: descricao,
            redes: redes,
            timestamp: new Date().toISOString()
        };

        const n8nResponse = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(n8nPayload)
        });

        console.log('[Postagem] Resposta do n8n status:', n8nResponse.status);
        
        let n8nData = {};
        try {
            const text = await n8nResponse.text();
            try {
                n8nData = JSON.parse(text);
            } catch (e) {
                n8nData = { message: text };
            }
        } catch (e) {
            console.warn('[Postagem] Erro ao ler resposta do n8n');
        }

        if (!n8nResponse.ok) {
            throw new Error(n8nData.message || `n8n erro: ${n8nResponse.status}`);
        }

        // 6. Registrar no log de mensagens para o histórico
        try {
            await pool.query(
                "INSERT INTO message_logs (record_id, template_name, message_content, status, response_data) VALUES ($1, $2, $3, $4, $5)",
                [req.body.record_id || null, 'Post Studio', descricao || 'Postagem sem legenda', n8nResponse.ok ? 'Sucesso' : 'Falha', JSON.stringify(n8nData)]
            );
        } catch (logErr) {
            console.error('[Postagem] Erro ao salvar log:', logErr);
        }

        res.json({
            success: true,
            message: 'Postagem processada pelo n8n.',
            image_url: publicUrl,
            results: n8nData.results || n8nData
        });

    } catch (err) {
        console.error('[Postagem Error]', err);
        res.status(500).json({ message: 'Erro ao processar postagem.', error: err.message });
    }
});

// ── Histórico Post Studio ────────────────────────────────────────────────────

router.get('/post-studio/history', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, record_id, message_content, status, sent_at, response_data FROM message_logs WHERE template_name = 'Post Studio' ORDER BY sent_at DESC LIMIT 50"
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[Post Studio History Error]', err);
        res.status(500).json({ message: 'Erro ao buscar histórico do Post Studio.' });
    }
});

module.exports = router;
