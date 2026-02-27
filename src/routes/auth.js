const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const fetch = require('node-fetch');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
});

const JWT_SECRET = process.env.JWT_SECRET || 'poisson-jwt-secret-change-in-production';
const JWT_EXPIRES = '15m';
const REFRESH_EXPIRES_DAYS = 7;
const BCRYPT_ROUNDS = 12;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Rate limiting
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: 'Muitas tentativas. Tente novamente em 15 minutos.' },
    standardHeaders: true, legacyHeaders: false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function getMailer() {
    // Busca SMTP do banco
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'smtp_config'");
    const config = rows[0]?.value;

    if (!config || !config.host || !config.user || !config.pass) {
        // Fallback para env se não houver config no DB
        if (!process.env.SMTP_USER) return null;
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    return nodemailer.createTransport({
        host: config.host,
        port: parseInt(config.port),
        secure: parseInt(config.port) === 465,
        auth: {
            user: config.user,
            pass: config.pass,
        },
    });
}

async function verifyRecaptcha(token) {
    if (!process.env.RECAPTCHA_SECRET_KEY) return true; // Ignora se não houver chave
    if (!token) return false;
    try {
        const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`
        });
        const data = await response.json();
        // Google recomenda score >= 0.5 para fluxos de autenticação
        return data.success && data.score >= 0.5;
    } catch (err) {
        console.error('[Recaptcha Error]', err);
        return false;
    }
}

// ── Registro ──────────────────────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
    const { name, email, password, recaptchaToken } = req.body;

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
            'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name, role',
            [name, email.toLowerCase(), hash]
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
            'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
            [email.toLowerCase()]
        );
        const user = rows[0];
        if (!user || !user.password_hash)
            return res.status(401).json({ message: 'Credenciais inválidas.' });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid)
            return res.status(401).json({ message: 'Credenciais inválidas.' });

        const accessToken = generateAccessToken(user);
        await createRefreshToken(user.id, res);

        const { password_hash, ...safeUser } = user;
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

        // Busca SMTP e Templates
        const { rows: smtpRows } = await pool.query("SELECT value FROM settings WHERE key = 'smtp_config'");
        const { rows: templateRows } = await pool.query("SELECT value FROM settings WHERE key = 'system_templates'");

        const smtp = smtpRows[0]?.value;
        const systemTemplates = templateRows[0]?.value;

        const mailer = await getMailer();
        if (mailer) {
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

            await mailer.sendMail({
                from: smtp ? `${smtp.from_name} <${smtp.from_email}>` : `Poisson ERP <${process.env.SMTP_USER}>`,
                to: email,
                subject: template.subject,
                html: html,
            });
        } else {
            console.log(`[auth] Reset URL: ${resetUrl}`);
        }

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

// ── OTP / Código por E-mail ──────────────────────────────────────────────────
router.post('/send-otp', authLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'E-mail obrigatório.' });

    try {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

        await pool.query(
            `INSERT INTO users (email, name, otp_code, otp_expires) 
             VALUES ($1, 'Usuário Poisson', $2, $3)
             ON CONFLICT (email) DO UPDATE SET otp_code = $2, otp_expires = $3`,
            [email.toLowerCase(), otp, expires]
        );

        const { rows: smtpRows } = await pool.query("SELECT value FROM settings WHERE key = 'smtp_config'");
        const { rows: templateRows } = await pool.query("SELECT value FROM settings WHERE key = 'system_templates'");
        
        const smtp = smtpRows[0]?.value;
        const systemTemplates = templateRows[0]?.value;

        const mailer = await getMailer();
        if (mailer) {
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

            await mailer.sendMail({
                from: smtp ? `${smtp.from_name} <${smtp.from_email}>` : `Poisson ERP <${process.env.SMTP_USER}>`,
                to: email,
                subject: template.subject,
                html: html,
            });
        }

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

        const { password_hash, otp_code, otp_expires, ...safeUser } = user;
        res.json({ user: safeUser, accessToken });
    } catch (err) {
        res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

module.exports = router;
