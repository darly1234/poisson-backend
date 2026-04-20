const express = require('express');
const router = express.Router();
const pool = require('../db');
const fetch = require('node-fetch');
// const sharp = require('sharp'); // Removido do topo para evitar erro se não estiver instalado
const { encrypt, decrypt } = require('../utils/crypto');
const fs = require('fs');
const path = require('path');

// ── Mensagens / Envio ─────────────────────────────────────────────────────────

// ── Slack API (n8n Bridge - evita conexão direta Postgres) ──────────────────
// Criar tabela se não existir
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificacoes_slack (
                id SERIAL PRIMARY KEY,
                record_id TEXT,
                id_grupo TEXT,
                parent_grupo TEXT NULL,
                usuario_destino TEXT,
                nome_destino TEXT,
                mensagem TEXT,
                status TEXT,
                data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                data_leitura TIMESTAMP NULL
            )
        `);
        // Migração: adiciona parent_grupo se não existir
        await pool.query(`ALTER TABLE notificacoes_slack ADD COLUMN IF NOT EXISTS parent_grupo TEXT NULL`);
    } catch(err) { console.error('[Slack Table Check]', err.message); }
})();

// 1. Listar Destinatários do Slack (n8n chama este GET)
router.get('/n8n/slack-recipients', async (req, res) => {
    try {
        const result = await pool.query("SELECT slack_id as id, slack_id, nome as name FROM canais_notificacao ORDER BY nome ASC");
        res.json(result.rows);
    } catch (err) {
        console.error('[n8n Slack Bridge] Erro ao buscar destinatários:', err.message);
        res.status(500).json({ error: 'Erro ao buscar no banco.' });
    }
});

// 2. Sincronizar Destinatários (n8n chama este POST para enviar a lista real do Slack)
router.post('/n8n/sync-recipients', async (req, res) => {
    const { recipients } = req.body; // Array de { nome, slack_id, tipo }
    if (!Array.isArray(recipients)) return res.status(400).json({ error: 'Formato inválido. Esperado array.' });

    try {
        for (const r of recipients) {
            await pool.query(
                `INSERT INTO canais_notificacao (nome, slack_id, tipo) 
                 VALUES ($1, $2, $3)
                 ON CONFLICT (slack_id) DO UPDATE SET nome = EXCLUDED.nome, tipo = EXCLUDED.tipo`,
                [r.nome, r.slack_id, r.tipo || 'user']
            );
        }
        res.json({ success: true, count: recipients.length });
    } catch (err) {
        console.error('[n8n Slack Bridge] Erro ao sincronizar:', err.message);
        res.status(500).json({ error: 'Erro ao salvar no banco.' });
    }
});

// 3. Salvar log de Envio OU Confirmação de Leitura (n8n chama este POST)
// Quando status === "LIDO": atualiza o registro com confirmação de leitura (auditoria)
// Caso contrário: salva log de envio inicial
router.post('/n8n/slack-save', async (req, res) => {
    const { recordId, status, usuario, groupId, recipients, message } = req.body;

    // ── Confirmação de Leitura (botão clicado no Slack) ─────────────────────
    if (status === 'LIDO') {
        if (!recordId || !usuario) {
            return res.status(400).json({ error: 'recordId e usuario são obrigatórios.' });
        }
        try {
            const idStr = String(recordId);
            const groupIdStr = groupId ? String(groupId) : null;
            const dataLeitura = new Date().toISOString();

            let updateResult;
            if (groupIdStr) {
                // Precisão total: marca apenas a mensagem específica daquele disparo + usuário
                updateResult = await pool.query(
                    `UPDATE notificacoes_slack
                     SET status = 'confirmado', data_leitura = NOW()
                     WHERE id_grupo = $1
                       AND (
                         usuario_destino = $2
                         OR nome_destino = $2
                         OR usuario_destino = (SELECT slack_id FROM canais_notificacao WHERE LOWER(nome) = LOWER($2) LIMIT 1)
                       )
                       AND status != 'confirmado'`,
                    [groupIdStr, usuario]
                );
            } else {
                // Fallback sem groupId: marca apenas a 1 linha mais recente daquele usuário/record
                updateResult = await pool.query(
                    `UPDATE notificacoes_slack
                     SET status = 'confirmado', data_leitura = NOW()
                     WHERE id = (
                         SELECT id FROM notificacoes_slack
                         WHERE record_id = $1
                           AND (
                             usuario_destino = $2
                             OR nome_destino = $2
                             OR usuario_destino = (SELECT slack_id FROM canais_notificacao WHERE LOWER(nome) = LOWER($2) LIMIT 1)
                           )
                           AND status != 'confirmado'
                         ORDER BY data_envio DESC
                         LIMIT 1
                     )`,
                    [idStr, usuario]
                );
            }

            console.log(`[n8n Slack Save] Rows updated: ${updateResult.rowCount}, groupId=${groupIdStr}, usuario=${usuario}`);

            // Se havia um parent_grupo (reenvio), marca o original como lido também
            if (groupIdStr) {
                const parentRes = await pool.query(
                    `SELECT DISTINCT parent_grupo FROM notificacoes_slack WHERE id_grupo = $1 AND parent_grupo IS NOT NULL LIMIT 1`,
                    [groupIdStr]
                );
                const parentGrupo = parentRes.rows[0]?.parent_grupo;
                if (parentGrupo) {
                    await pool.query(
                        `UPDATE notificacoes_slack
                         SET status = 'confirmado', data_leitura = NOW()
                         WHERE id_grupo = $1
                           AND (usuario_destino = $2 OR nome_destino = $2)
                           AND status != 'confirmado'`,
                        [parentGrupo, usuario]
                    );
                    console.log(`[n8n Slack Save] Parent grupo marcado como lido: ${parentGrupo}`);
                }
            }

            // Auditoria: registra quem leu e quando
            await pool.query(
                `INSERT INTO message_logs (record_id, template_name, message_content, status, response_data)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    idStr,
                    'Slack - Confirmação de Leitura',
                    `Leitura confirmada por: ${usuario}`,
                    'Sucesso',
                    JSON.stringify({ usuario, groupId: groupIdStr, data_leitura: dataLeitura, recordId: idStr })
                ]
            );

            console.log(`[n8n Slack Save] Leitura confirmada: record=${idStr}, groupId=${groupIdStr}, usuario=${usuario}`);
            return res.json({ success: true });
        } catch (err) {
            console.error('[n8n Slack Save] Erro ao salvar confirmação de leitura:', err.message);
            return res.status(500).json({ error: 'Erro ao atualizar confirmação de leitura.' });
        }
    }

    // ── Log de Envio Inicial ─────────────────────────────────────────────────
    try {
        const list = Array.isArray(recipients) ? [...recipients] : [];
        if (list.length === 0) {
            const single = {
                id: req.body.slack_id || req.body.id_destino,
                name: req.body.name || req.body.nome || 'Destinatário Desconhecido'
            };
            if (single.id) list.push(single);
        }

        if (list.length === 0) {
            return res.json({ success: true, count: 0 });
        }

        const finalRecordId = String(recordId || req.body.groupId || '');
        const finalGroupId = String(req.body.groupId || recordId || '');

        const queries = list.map(r =>
            pool.query(
                "INSERT INTO notificacoes_slack (record_id, id_grupo, usuario_destino, nome_destino, mensagem, status, data_envio) VALUES ($1, $2, $3, $4, $5, $6, NOW())",
                [finalRecordId, finalGroupId, r.slack_id || r.id || '', r.name || r.nome || 'Destinatário', message || '', 'enviado']
            )
        );

        await Promise.all(queries);
        res.json({ success: true, count: list.length });
    } catch (err) {
        console.error('[n8n Slack Bridge] Erro ao salvar log de envio (v2.30):', err.message);
        res.status(500).json({ error: 'Erro ao salvar no banco.' });
    }
});

// 3. Atualizar status de Leitura (n8n chama este POST quando alguém clica no Slack)
router.post('/n8n/slack-update', async (req, res) => {
    const { slack_id, groupId } = req.body;
    try {
        await pool.query(
            "UPDATE notificacoes_slack SET status = 'confirmado', data_leitura = NOW() WHERE usuario_destino = $1 AND id_grupo = $2 AND status = 'enviado'",
            [slack_id, groupId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[n8n Slack Bridge] Erro ao atualizar status:', err.message);
        res.status(500).json({ error: 'Erro ao atualizar no banco.' });
    }
});

// 4. Túnel de Disparo (ERP chama este POST para evitar erro de CORS do n8n)
router.post('/n8n/slack-dispatch', async (req, res) => {
    const { recordId, message, recipients, parentGroupId } = req.body;
    try {
        // 1. Buscar as configurações do Slack
        const settingsRes = await pool.query("SELECT value FROM settings WHERE key = 'slack_settings'");
        let slackSettings = settingsRes.rows[0]?.value;
        let webhookUrl = 'https://n8.poisson.com.br/webhook/slack-enviar-mensagem';

        if (slackSettings) {
            try {
                // Caso esteja no formato { encrypted: "..." }
                let configData = slackSettings;
                if (typeof configData === 'object' && configData.encrypted) {
                    configData = configData.encrypted;
                }

                // Se for uma string com IV (iv:content)
                if (typeof configData === 'string' && configData.includes(':')) {
                    const decrypted = decrypt(configData);
                    try {
                        const parsed = JSON.parse(decrypted);
                        if (parsed && parsed.url_envio) webhookUrl = parsed.url_envio;
                    } catch (e) {
                        // Se não for JSON, tenta usar como string pura
                        if (decrypted && decrypted.startsWith('http')) webhookUrl = decrypted;
                    }
                } else if (typeof configData === 'object' && configData.url_envio) {
                    webhookUrl = configData.url_envio;
                }
            } catch (err) {
                console.error('[n8n Slack Dispatch] Falha na descriptografia (usando fallback):', err.message);
            }
        }

        console.log('[n8n Slack Dispatch] Disparando para:', webhookUrl);

        // 2. Gerar groupId único para este envio
        const groupId = `${recordId}-${Date.now()}`;

        // 3. Salvar no histórico local ANTES de enviar (garante registro mesmo se n8n falhar)
        try {
            const list = Array.isArray(recipients) ? recipients.filter(r => r.slack_id || r.id) : [];
            const insertQueries = list.map(r =>
                pool.query(
                    "INSERT INTO notificacoes_slack (record_id, id_grupo, parent_grupo, usuario_destino, nome_destino, mensagem, status, data_envio) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
                    [recordId, groupId, parentGroupId || null, r.slack_id || r.id, r.name || r.nome || 'Destinatário', message, 'enviado']
                )
            );
            if (insertQueries.length > 0) await Promise.all(insertQueries);
        } catch (dbErr) {
            console.error('[n8n Slack Dispatch] Erro ao salvar histórico local:', dbErr.message);
            // Continua o envio mesmo se o log falhar
        }

        // 4. Repassar para o n8n via server-side fetch
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recordId,
                groupId,
                message,
                recipients: recipients || []
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            return res.status(response.status).json({
                error: `n8n recusou: ${response.status}`,
                details: errBody
            });
        }

        res.json({ success: true, groupId });
    } catch (err) {
        console.error('[n8n Slack Dispatch] ERRO FATAL NO TÚNEL:', err.message);
        res.status(500).json({ error: 'Erro interno no túnel de disparo', details: err.message });
    }
});

// 5a. Deletar grupo de mensagem específico
router.delete('/slack/group/:groupId', async (req, res) => {
    try {
        const result = await pool.query(
            "DELETE FROM notificacoes_slack WHERE id_grupo = $1",
            [req.params.groupId]
        );
        res.json({ success: true, deleted: result.rowCount });
    } catch (err) {
        console.error('[Slack Delete Group]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 5. Listar Histórico (ERP chama este via api.js)
router.get('/history-slack/:recordId', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, id_grupo, usuario_destino, nome_destino, mensagem, status, data_envio, data_leitura FROM notificacoes_slack WHERE record_id = $1 OR id_grupo = $1 ORDER BY data_envio DESC",
            [req.params.recordId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[Slack History] Erro:', err.message);
        res.status(500).json({ error: 'Erro ao buscar histórico.' });
    }
});

// ── Mensagens Legadas / Gerais ───────────────────────────────────────────────
router.post('/send', async (req, res) => {
    const { recordId, subject, message, templateName, recipient } = req.body;

    if (!recordId || !message) {
        return res.status(400).json({ message: 'RecordID e Mensagem são obrigatórios.' });
    }

    try {
        // 1. Buscar configurações SMTP (onde fica o endpoint n8n)
        const smtpRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_config'");
        let smtpConfig = smtpRes.rows[0]?.value || {};
        // Formato { encrypted: "iv:content" } — padrão atual do sistema
        if (smtpConfig && typeof smtpConfig === 'object' && smtpConfig.encrypted) {
            try { smtpConfig = JSON.parse(decrypt(smtpConfig.encrypted)); } catch(e) { smtpConfig = {}; }
        } else if (typeof smtpConfig === 'string') {
            try { smtpConfig = JSON.parse(smtpConfig); } catch(e) {}
            if (typeof smtpConfig === 'string' && smtpConfig.includes(':')) {
                try { smtpConfig = JSON.parse(decrypt(smtpConfig)); } catch(e) { smtpConfig = {}; }
            }
        }

        const n8nEndpoint = smtpConfig?.n8n_endpoint || '';

        if (!n8nEndpoint) {
            return res.status(500).json({ message: 'Endpoint n8n não configurado. Vá em Configurações → E-mail → Endpoint n8n.' });
        }

        // 2. Buscar dados do registro
        const recordRes = await pool.query("SELECT data FROM records WHERE id = $1", [recordId]);
        if (recordRes.rows.length === 0) {
            return res.status(404).json({ message: 'Registro não encontrado.' });
        }
        const recordData = recordRes.rows[0].data || {};

        // 3. Montar destinatário: usa o recipient enviado pelo frontend, ou cai no primeiro negociador
        let toEmail = recipient?.email || '';
        let toPhone = recipient?.phone || recipient?.telefone || '';
        let toNome  = recipient?.nome || '';

        if (!toEmail) {
            const negotiators = Array.isArray(recordData.f_negotiators) ? recordData.f_negotiators : [];
            const first = negotiators[0] || {};
            toEmail = first.email || '';
            toPhone = (first.telefone || '').replace(/\D/g, '');
            toNome  = first.nome || '';
        } else {
            toPhone = toPhone.replace(/\D/g, '');
        }

        const payload = {
            // Destinatário
            to_email: toEmail,
            to_phone: toPhone || null,   // null = sem WhatsApp, não envia string vazia
            to_nome:  toNome,
            // Remetente
            from_name:  smtpConfig.from_name  || 'Editora Poisson',
            from_email: smtpConfig.from_email  || '',
            // Conteúdo
            subject: subject || '',
            message: message,
            // Contexto do registro
            record_id: recordId,
            titulo: recordData.titulo || recordData.f_titulo || '',
            isbn:   recordData.isbn   || recordData.f7 || '',
            doi:    recordData.doi    || recordData.f_doi || '',
        };

        // 4. Disparar para o n8n
        console.log('[n8n Email] Enviando para:', n8nEndpoint, '| to:', toEmail);
        const response = await fetch(n8nEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const status = response.ok ? 'Sucesso' : 'Falha';
        let responseData = {};
        try { responseData = await response.json(); } catch (e) {
            console.warn('[n8n Email] Resposta não é JSON');
        }

        // 5. Registrar no log
        await pool.query(
            "INSERT INTO message_logs (record_id, template_name, message_content, status, response_data) VALUES ($1, $2, $3, $4, $5)",
            [recordId, templateName || 'Personalizada', `[Para: ${toEmail}] [Assunto: ${subject || 'Sem Assunto'}]\n\n${message}`, status, JSON.stringify(responseData)]
        );

        if (response.ok) {
            res.json({ success: true, status });
        } else {
            console.error('[n8n Email] Erro:', response.status, responseData);
            res.status(response.status).json({ success: false, status, error: responseData });
        }

    } catch (err) {
        console.error('[Webhook Send Error]', err);
        res.status(500).json({ message: 'Erro interno ao processar o envio.', details: err.message });
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

// 5. Apagar log de um grupo específico do Slack
router.delete('/slack/group/:groupId', async (req, res) => {
    try {
        await pool.query("DELETE FROM notificacoes_slack WHERE id_grupo = $1", [req.params.groupId]);
        res.json({ success: true });
    } catch (err) {
        console.error('[Slack Delete Group Error]', err);
        res.status(500).json({ message: 'Erro ao deletar grupo do Slack.' });
    }
});

// 6. Apagar logs antigos de um recordId com seletor de data
router.delete('/slack/old/:recordId', async (req, res) => {
    const { days, beforeDate } = req.query;
    try {
        let query = "DELETE FROM notificacoes_slack WHERE record_id = $1";
        const params = [req.params.recordId];

        if (beforeDate) {
            query += " AND data_envio < $2::timestamp";
            params.push(beforeDate);
        } else if (days) {
            query += ` AND data_envio < NOW() - INTERVAL '${parseInt(days, 10)} days'`;
        } else {
            query += " AND data_envio < NOW() - INTERVAL '30 days'";
        }

        await pool.query(query, params);
        res.json({ success: true });
    } catch (err) {
        console.error('[Slack Delete Old Error]', err);
        res.status(500).json({ message: 'Erro ao deletar logs antigos do Slack.' });
    }
});

module.exports = router;
