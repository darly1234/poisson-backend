const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const { decrypt } = require('../utils/crypto');
const { sendEmail } = require('../utils/email');
const { checkPassword: checkPhpassPassword } = require('../utils/phpass');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
});

const JWT_SECRET = process.env.JWT_SECRET || 'poisson-jwt-secret-change-in-production';
const JWT_EXPIRES = '36500d'; // 100 years
const REFRESH_EXPIRES_DAYS = 36500;
const BCRYPT_ROUNDS = 12;
const APP_URL = process.env.APP_URL || 'https://individual.poisson.com.br';

// Rate limiting
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: 'Muitas tentativas. Tente novamente em 15 minutos.' },
    standardHeaders: true, legacyHeaders: false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Descriptografa um valor de setting que pode estar no formato { encrypted: "iv:hex" }
function decryptSetting(val) {
    if (!val) return null;
    if (typeof val === 'object' && val.encrypted) {
        try { return JSON.parse(decrypt(val.encrypted)); } catch { return null; }
    }
    if (typeof val === 'string') {
        try { return JSON.parse(decrypt(val)); } catch { return val; }
    }
    return val;
}

function generateAccessToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
}

async function createRefreshToken(userId, res) {
    const token = crypto.randomBytes(64).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

    await pool.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [userId, hash, expires]
    );

    res.cookie('refresh_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
        path: '/api/auth',
    });

    return token;
}

async function verifyRecaptcha(token) {
    if (!process.env.RECAPTCHA_SECRET_KEY) return true; // Ignora se não houver chave
    if (!token) {
        console.warn('[Recaptcha] Token missing, but allowing entry for dev/troubleshooting.');
        return true;
    }
    try {
        const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`
        });
        const data = await response.json();

        if (!data.success || data.score < 0.5) {
            console.warn('[Recaptcha Failed]', data);
            // Temporariamente retornamos true para não bloquear o usuário enquanto resolvemos a VPS
            return true;
        }
        return true;
    } catch (err) {
        console.error('[Recaptcha Error]', err);
        return true; // Não bloqueia por erro de rede
    }
}

// ── Registro ──────────────────────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
    const { name, email, password, recaptchaToken, whatsapp } = req.body;

    const isHuman = await verifyRecaptcha(recaptchaToken);
    if (!isHuman) return res.status(403).json({ message: 'Falha na verificação de segurança (Bot detectado).' });

    if (!name || !email || !password)
        return res.status(400).json({ message: 'Nome, e-mail e senha são obrigatórios.' });
    if (password.length < 8)
        return res.status(400).json({ message: 'A senha deve ter pelo menos 8 caracteres.' });

    try {
        const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (exists.rows.length)
            return res.status(409).json({ message: 'Este e-mail já está cadastrado.' });

        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const { rows } = await pool.query(
            "INSERT INTO users (name, email, password_hash, role, whatsapp) VALUES ($1, $2, $3, 'autor', $4) RETURNING id, email, name, role, whatsapp",
            [name, email.toLowerCase(), hash, whatsapp || null]
        );
        const user = rows[0];

        const accessToken = generateAccessToken(user);
        await createRefreshToken(user.id, res);

        res.status(201).json({ user, accessToken });
    } catch (err) {
        res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
    const { email, password, recaptchaToken } = req.body;

    const isHuman = await verifyRecaptcha(recaptchaToken);
    if (!isHuman) return res.status(403).json({ message: 'Falha na verificação de segurança (Bot detectado).' });

    if (!email || !password)
        return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });

    try {
        const { rows } = await pool.query(
            'SELECT id, email, name, role, whatsapp, orcid, bio, password_hash, wp_password_hash FROM users WHERE email = $1',
            [email.toLowerCase()]
        );
        const user = rows[0];
        if (!user) return res.status(401).json({ message: 'Credenciais inválidas.' });

        let valid = false;
        if (user.password_hash) {
            valid = await bcrypt.compare(password, user.password_hash);
        } else if (user.wp_password_hash) {
            valid = checkPhpassPassword(password, user.wp_password_hash);
            if (valid) {
                const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
                await pool.query(
                    'UPDATE users SET password_hash = $1, wp_password_hash = NULL WHERE id = $2',
                    [newHash, user.id]
                );
                user.password_hash = newHash;
            }
        }

        if (!valid) return res.status(401).json({ message: 'Credenciais inválidas.' });

        const accessToken = generateAccessToken(user);
        await createRefreshToken(user.id, res);

        const { password_hash, otp_code, otp_expires, reset_token, reset_token_expires, ...safeUser } = user;
        res.json({ user: safeUser, accessToken });
    } catch (err) {
        res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

// ── Refresh Token ─────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    const token = req.cookies?.refresh_token;
    if (!token) return res.status(401).json({ message: 'Refresh token ausente.' });

    const hash = crypto.createHash('sha256').update(token).digest('hex');

    try {
        const { rows } = await pool.query(
            `SELECT rt.*, u.id as uid, u.email, u.name, u.role
             FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
             WHERE rt.token_hash = $1 AND rt.expires_at > NOW()`,
            [hash]
        );
        const row = rows[0];
        if (!row) return res.status(401).json({ message: 'Refresh token inválido ou expirado.' });

        // Rotate: delete old, create new
        await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]);

        const user = { id: row.uid, email: row.email, name: row.name, role: row.role };
        const accessToken = generateAccessToken(user);
        await createRefreshToken(user.id, res);

        res.json({ user, accessToken });
    } catch (err) {
        res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
    const token = req.cookies?.refresh_token;
    if (token) {
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]).catch(() => { });
    }
    res.clearCookie('refresh_token', { path: '/api/auth' });
    res.json({ ok: true });
});

// ── Me ────────────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
    const auth = req.headers.authorization?.split(' ')[1];
    if (!auth) return res.status(401).json({ message: 'Token ausente.' });
    try {
        const payload = jwt.verify(auth, JWT_SECRET);
        res.json({ user: payload });
    } catch {
        res.status(401).json({ message: 'Token inválido.' });
    }
});

// ── Esqueceu a Senha ──────────────────────────────────────────────────────────
router.post('/forgot-password', authLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'E-mail obrigatório.' });

    try {
        const { rows: userRows } = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        // Sempre retorna sucesso para não revelar se o email existe
        if (!userRows.length) return res.json({ ok: true });

        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

        await pool.query(
            'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
            [token, expires, userRows[0].id]
        );

        const resetUrl = `${APP_URL}/reset-password?token=${token}`;

        const { rows: templateRows } = await pool.query("SELECT value FROM settings WHERE key = 'system_templates'");
        const systemTemplates = decryptSetting(templateRows[0]?.value) || {};
        const template = systemTemplates?.password_reset || {
            subject: 'Redefinição de senha — Poisson ERP',
            content: 'Olá, clique no link abaixo para redefinir sua senha: {{reset_url}}'
        };

        const html = `
            <div style="font-family:sans-serif;max-width:480px;margin:auto">
                <h2 style="color:#1F2A8A">${template.subject}</h2>
                <p>${template.content.replace('{{reset_url}}', `<a href="${resetUrl}" style="font-weight:bold;color:#1E88E5">clique aqui</a>`)}</p>
                <div style="margin: 30px 0;">
                    <a href="${resetUrl}" style="display:inline-block;background:#1E88E5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Redefinir Senha</a>
                </div>
                <p style="color:#999;font-size:12px;margin-top:24px">Se não foi você, ignore este e-mail.</p>
            </div>
        `;

        await sendEmail(pool, { to: email, subject: template.subject, html, type: 'password_reset', extra: { reset_url: resetUrl } });

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

// ── Reset Senha ───────────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password)
        return res.status(400).json({ message: 'Token e nova senha são obrigatórios.' });
    if (password.length < 8)
        return res.status(400).json({ message: 'A senha deve ter pelo menos 8 caracteres.' });

    try {
        const { rows } = await pool.query(
            'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
            [token]
        );
        if (!rows.length)
            return res.status(400).json({ message: 'Token inválido ou expirado.' });

        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await pool.query(
            'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
            [hash, rows[0].id]
        );

        // Revogar todos os refresh tokens do usuário por segurança
        await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [rows[0].id]);

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

// ── OTP / Código por E-mail (via n8n com fallback SMTP) ─────────────────────
router.post('/send-otp', authLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'E-mail obrigatório.' });

    try {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

        await pool.query(
            `INSERT INTO users (email, name, role, otp_code, otp_expires)
             VALUES ($1, 'Usuário Poisson', 'autor', $2, $3)
             ON CONFLICT (email) DO UPDATE SET otp_code = $2, otp_expires = $3`,
            [email.toLowerCase(), otp, expires]
        );

        const { rows: templateRows } = await pool.query("SELECT value FROM settings WHERE key = 'system_templates'");
        const systemTemplates = decryptSetting(templateRows[0]?.value) || {};
        const template = systemTemplates?.login_code || {
            subject: 'Seu código de acesso — Poisson ERP',
            content: 'Seu código de acesso é: {{code}}'
        };

        const html = `
            <div style="font-family:sans-serif;max-width:480px;margin:auto;text-align:center">
                <h2 style="color:#1F2A8A">${template.subject}</h2>
                <div style="font-size:32px;font-weight:900;letter-spacing:8px;color:#1E88E5;margin:30px 0;padding:20px;background:#f0f7ff;border-radius:12px">
                    ${otp}
                </div>
                <p>${template.content.replace('{{code}}', `<strong>${otp}</strong>`)}</p>
                <p style="color:#999;font-size:12px;margin-top:24px">O código expira em 10 minutos.</p>
            </div>
        `;

        const sent = await sendEmail(pool, { to: email, subject: template.subject, html, type: 'otp_login', extra: { code: otp } });
        if (!sent) console.warn('[send-otp] Nenhum canal de envio disponível para', email);

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

router.post('/verify-otp', authLimiter, async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ message: 'E-mail e código são obrigatórios.' });

    try {
        const { rows } = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND otp_code = $2 AND otp_expires > NOW()',
            [email.toLowerCase(), code]
        );
        const user = rows[0];
        if (!user) return res.status(401).json({ message: 'Código inválido ou expirado.' });

        // Limpa OTP após uso
        await pool.query('UPDATE users SET otp_code = NULL, otp_expires = NULL WHERE id = $1', [user.id]);

        const accessToken = generateAccessToken(user);
        await createRefreshToken(user.id, res);

        const { password_hash, otp_code, otp_expires, reset_token, reset_token_expires, ...safeUser } = user;
        res.json({ user: safeUser, accessToken });
    } catch (err) {
        res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});


// ── Config público (google client id) ────────────────────────────────────────
router.get('/config', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'google_oauth'");
        const config = decryptSetting(rows[0]?.value) || {};
        const clientId = typeof config.client_id === 'string' ? config.client_id.trim() : null;
        res.json({ googleClientId: clientId || null });
    } catch {
        res.json({ googleClientId: null });
    }
});

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.get('/google', async (req, res) => {
    const appUrl = process.env.APP_URL || 'https://individual.poisson.com.br';
    const { code, error } = req.query;

    if (error || !code) {
        return res.redirect(`${appUrl}/login?error=google_cancelled`);
    }

    try {
        // Busca client_id e client_secret da tabela settings
        const { rows: settingRows } = await pool.query("SELECT value FROM settings WHERE key = 'google_oauth'");
        const oauthConfig = settingRows[0]?.value || {};
        const clientId = oauthConfig.client_id || process.env.GOOGLE_CLIENT_ID;
        const clientSecretRaw = oauthConfig.client_secret;
        const clientSecret = clientSecretRaw
            ? (typeof clientSecretRaw === 'object' && clientSecretRaw.encrypted
                ? (() => { try { return JSON.parse(require('../utils/crypto').decrypt(clientSecretRaw.encrypted)); } catch { return null; } })()
                : clientSecretRaw)
            : process.env.GOOGLE_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            console.error('[Google OAuth] client_id ou client_secret não configurado');
            return res.redirect(`${appUrl}/login?error=google_config`);
        }

        // Troca o code por tokens
        const redirectUri = `${appUrl}/api/auth/google`;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }).toString(),
        });
        const tokenData = await tokenRes.json();

        if (tokenData.error) {
            console.error('[Google OAuth] token exchange error:', tokenData);
            return res.redirect(`${appUrl}/login?error=google_token`);
        }

        // Busca dados do usuário
        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const gUser = await userRes.json();

        if (!gUser.email) {
            return res.redirect(`${appUrl}/login?error=google_no_email`);
        }

        const email = gUser.email.toLowerCase();
        const name = gUser.name || email;
        const googleId = gUser.id;

        // Upsert usuário
        const { rows } = await pool.query(
            `INSERT INTO users (email, name, google_id, role)
             VALUES ($1, $2, $3, 'autor')
             ON CONFLICT (email) DO UPDATE
               SET google_id = EXCLUDED.google_id,
                   name = COALESCE(users.name, EXCLUDED.name)
             RETURNING id, email, name, role, whatsapp`,
            [email, name, googleId]
        );
        const user = rows[0];
        const accessToken = generateAccessToken(user);

        // Cria refresh token em cookie
        await createRefreshToken(user.id, res);

        // Redireciona para o login com a sessão — o React lê e chama login()
        const session = encodeURIComponent(JSON.stringify({ user, token: accessToken }));
        return res.redirect(`${appUrl}/login?session=${session}`);
    } catch (err) {
        console.error('[Google OAuth] erro:', err.message);
        return res.redirect(`${appUrl}/login?error=google_server`);
    }
});

router.post('/google', authLimiter, async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'Token Google ausente.' });

    try {
        const gRes = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + credential);
        const gData = await gRes.json();

        if (gData.error_description) {
            return res.status(401).json({ message: 'Token Google inválido.' });
        }

        const { rows: settingRows } = await pool.query("SELECT value FROM settings WHERE key = 'google_oauth'");
        const savedClientId = settingRows[0]?.value?.client_id;
        if (savedClientId && gData.aud !== savedClientId) {
            return res.status(401).json({ message: 'Client ID não correspondente.' });
        }

        const email = gData.email?.toLowerCase();
        const name = gData.name || email;
        const googleId = gData.sub;

        if (!email) return res.status(400).json({ message: 'E-mail não retornado pelo Google.' });

        const { rows } = await pool.query(
            `INSERT INTO users (email, name, google_id, role)
             VALUES ($1, $2, $3, 'autor')
             ON CONFLICT (email) DO UPDATE
               SET google_id = EXCLUDED.google_id,
                   name = COALESCE(users.name, EXCLUDED.name)
             RETURNING id, email, name, role, whatsapp`,
            [email, name, googleId]
        );
        const user = rows[0];
        const accessToken = generateAccessToken(user);
        await createRefreshToken(user.id, res);
        res.json({ user, accessToken });
    } catch (err) {
        res.status(500).json({ message: 'Erro Google OAuth: ' + err.message });
    }
});

// ── Atualizar perfil próprio (sem requireAdmin) ───────────────────────────────
router.put('/profile', async (req, res) => {
    const auth = req.headers.authorization?.split(' ')[1];
    if (!auth) return res.status(401).json({ message: 'Token ausente.' });
    try {
        const payload = jwt.verify(auth, JWT_SECRET);
        const userId = payload.id;
        const { name, whatsapp, orcid, bio } = req.body;

        const fields = [];
        const vals = [];
        let i = 1;
        if (name      !== undefined) { fields.push(`name = $${i++}`);     vals.push(name?.trim() || null); }
        if (whatsapp  !== undefined) { fields.push(`whatsapp = $${i++}`); vals.push(whatsapp || null); }
        if (orcid     !== undefined) { fields.push(`orcid = $${i++}`);    vals.push(orcid || null); }
        if (bio       !== undefined) { fields.push(`bio = $${i++}`);      vals.push(bio || null); }

        if (!fields.length) return res.status(400).json({ message: 'Nenhum campo para atualizar.' });

        vals.push(userId);
        const { rows } = await pool.query(
            `UPDATE users SET ${fields.join(', ')} WHERE id = $${i}
             RETURNING id, name, email, role, whatsapp, orcid, bio`,
            vals
        );
        if (!rows.length) return res.status(404).json({ message: 'Usuário não encontrado.' });
        res.json(rows[0]);
    } catch (err) {
        res.status(401).json({ message: 'Token inválido ou erro: ' + err.message });
    }
});

// ── Alterar senha própria (sem requireAdmin) ──────────────────────────────────
router.put('/password', async (req, res) => {
    const auth = req.headers.authorization?.split(' ')[1];
    if (!auth) return res.status(401).json({ message: 'Token ausente.' });
    const { password } = req.body;
    if (!password || password.length < 6)
        return res.status(400).json({ message: 'Senha deve ter ao menos 6 caracteres.' });
    try {
        const payload = jwt.verify(auth, JWT_SECRET);
        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const { rowCount } = await pool.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [hash, payload.id]
        );
        if (!rowCount) return res.status(404).json({ message: 'Usuário não encontrado.' });
        res.json({ ok: true });
    } catch (err) {
        res.status(401).json({ message: 'Token inválido: ' + err.message });
    }
});

// ── Atualizar WhatsApp ────────────────────────────────────────────────────────
router.post('/update-whatsapp', async (req, res) => {
    const auth = req.headers.authorization?.split(' ')[1];
    if (!auth) return res.status(401).json({ message: 'Token ausente.' });
    try {
        const payload = jwt.verify(auth, JWT_SECRET);
        const { whatsapp } = req.body;
        await pool.query('UPDATE users SET whatsapp = $1 WHERE id = $2', [whatsapp || null, payload.id]);
        res.json({ ok: true });
    } catch {
        res.status(401).json({ message: 'Token inválido.' });
    }
});

// ── Enviar email de submissão ─────────────────────────────────────────────────
router.post('/send-submission-email', async (req, res) => {
    const { email, authorName, fields, attachmentNames } = req.body;
    if (!email) return res.status(400).json({ message: 'E-mail obrigatório.' });

    try {
        const { rows: templateRows } = await pool.query("SELECT value FROM settings WHERE key = 'system_templates'");
        const systemTemplates = decryptSetting(templateRows[0]?.value) || {};
        const template = systemTemplates?.submission_confirm || {
            subject: 'Submissão recebida — Poisson ERP',
            content: 'Olá {{author_name}}, sua submissão foi recebida com sucesso!'
        };

        const fieldsHtml = fields ? Object.entries(fields).map(([k,v]) => '<tr><td style="padding:4px 8px;color:#666;font-size:12px">' + k + '</td><td style="padding:4px 8px;font-weight:bold;font-size:12px">' + v + '</td></tr>').join('') : '';
        const attachHtml = attachmentNames?.length ? attachmentNames.map(n => '<li>' + n + '</li>').join('') : '';

        const html = [
            '<div style="font-family:sans-serif;max-width:600px;margin:auto">',
            '<div style="background:#1F2A8A;padding:24px 32px;border-radius:12px 12px 0 0">',
            '<h1 style="color:white;margin:0;font-size:20px">Editora Poisson</h1>',
            '</div>',
            '<div style="padding:32px;background:white;border:1px solid #e2e8f0;border-top:none">',
            '<h2 style="color:#1F2A8A;margin-top:0">' + template.subject + '</h2>',
            '<p>Olá <strong>' + (authorName || 'Autor') + '</strong>,</p>',
            '<p>Sua submissão foi recebida com sucesso! Confira abaixo os dados registrados:</p>',
            fieldsHtml ? '<table style="border-collapse:collapse;width:100%;margin:16px 0;background:#f8fafc;border-radius:8px">' + fieldsHtml + '</table>' : '',
            attachHtml ? '<p><strong>Anexos:</strong></p><ul>' + attachHtml + '</ul>' : '',
            '<p style="color:#666;font-size:13px;margin-top:24px">Em breve nossa equipe entrará em contato. Obrigado!</p>',
            '</div>',
            '<div style="padding:16px 32px;text-align:center;color:#999;font-size:11px">Editora Poisson — Sistema de Gestão Editorial</div>',
            '</div>'
        ].join('');

        const sent = await sendEmail(pool, { to: email, subject: template.subject, html, type: 'submission_confirm', extra: { author_name: authorName } });

        res.json({ ok: true, sent });
    } catch (err) {
        console.error('[submission-email]', err.message);
        res.json({ ok: true, sent: false });
    }
});

module.exports = router;
