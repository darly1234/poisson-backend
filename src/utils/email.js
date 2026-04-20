/**
 * Utilitário centralizado de envio de e-mail.
 * Tenta n8n primeiro (endpoint em smtp_config.n8n_endpoint).
 * Fallback automático para SMTP nodemailer.
 */
const nodemailer = require('nodemailer');
const { decrypt } = require('./crypto');

// Importa pool de cada arquivo que chamar — passa como parâmetro
// para evitar dependência circular
async function getSmtpConfig(pool) {
    try {
        const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'smtp_config'");
        const raw = rows[0]?.value;
        if (!raw) return {};
        if (typeof raw === 'object' && raw.encrypted) {
            return JSON.parse(decrypt(raw.encrypted));
        }
        if (typeof raw === 'string') {
            return JSON.parse(decrypt(raw));
        }
        return raw;
    } catch { return {}; }
}

async function getMailer(smtp) {
    if (smtp?.host && smtp?.user && smtp?.pass) {
        return nodemailer.createTransport({
            host: smtp.host,
            port: parseInt(smtp.port) || 587,
            secure: parseInt(smtp.port) === 465,
            auth: { user: smtp.user, pass: smtp.pass },
        });
    }
    if (process.env.SMTP_USER) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: false,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
    }
    return null;
}

/**
 * Envia e-mail via n8n (primário) com fallback SMTP.
 *
 * @param {object} pool   - instância do pg Pool
 * @param {object} opts
 *   @param {string}  opts.to       - destinatário
 *   @param {string}  opts.subject  - assunto
 *   @param {string}  opts.html     - corpo HTML (para SMTP)
 *   @param {string}  [opts.type]   - tipo do evento n8n (ex: 'password_reset', 'otp_login')
 *   @param {object}  [opts.extra]  - campos extras passados ao n8n
 */
async function sendEmail(pool, { to, subject, html, type = 'generic', extra = {} }) {
    const smtp = await getSmtpConfig(pool);
    const n8nEndpoint = smtp?.n8n_endpoint;
    const fromName  = smtp?.from_name  || 'Editora Poisson';
    const fromEmail = smtp?.from_email || process.env.SMTP_USER || '';

    let sent = false;

    // ── 1. Tenta n8n ──────────────────────────────────────────────────────────
    if (n8nEndpoint) {
        try {
            const res = await fetch(n8nEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    to,
                    to_email: to,
                    subject,
                    body: html,
                    message: html,      // alias esperado pelo n8n
                    from_name: fromName,
                    from_email: fromEmail,
                    from_mail: fromEmail,
                    ...extra,
                }),
            });
            if (res.ok) {
                sent = true;
                console.log(`[email] n8n OK → ${to} (${type})`);
            } else {
                const txt = await res.text().catch(() => res.status);
                console.warn(`[email] n8n ${res.status}: ${txt}`);
            }
        } catch (err) {
            console.warn('[email] n8n falhou:', err.message);
        }
    }

    // ── 2. Fallback SMTP ──────────────────────────────────────────────────────
    if (!sent) {
        const mailer = await getMailer(smtp);
        if (mailer) {
            await mailer.sendMail({
                from: `${fromName} <${fromEmail}>`,
                to,
                subject,
                html,
            });
            sent = true;
            console.log(`[email] SMTP OK → ${to} (${type})`);
        }
    }

    if (!sent) console.warn(`[email] Nenhum canal disponível → ${to} (${type})`);

    return sent;
}

module.exports = { sendEmail, getSmtpConfig, getMailer };
