const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const BCRYPT_ROUNDS = 12;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Middleware: apenas admins
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ message: 'Acesso restrito a administradores.' });
  }
  next();
};

// Reutiliza getMailer do auth.js sem duplicar — busca SMTP nas settings
const getMailer = async () => {
  try {
    const nodemailer = require('nodemailer');
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'smtp_config'");
    const smtp = rows[0]?.value;
    if (!smtp?.host) return null;
    return nodemailer.createTransport({
      host: smtp.host, port: parseInt(smtp.port) || 587,
      secure: smtp.secure === true,
      auth: { user: smtp.user, pass: smtp.pass },
    });
  } catch { return null; }
};

// GET /api/users — listar todos os usuários
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY id ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/users — criar usuário
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Nome, e-mail e senha são obrigatórios.' });
  }
  const validRoles = ['admin', 'organizador', 'autor', 'user'];
  const userRole = validRoles.includes(role) ? role : 'autor';
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(400).json({ message: 'E-mail já cadastrado.' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, name, email, role, created_at',
      [name.trim(), email.toLowerCase().trim(), hash, userRole]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/users/:id — editar nome, e-mail ou role
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, role } = req.body;
  const { id } = req.params;
  const validRoles = ['admin', 'organizador', 'autor', 'user'];
  try {
    const fields = [];
    const vals = [];
    let i = 1;
    if (name) { fields.push(`name = $${i++}`); vals.push(name.trim()); }
    if (email) { fields.push(`email = $${i++}`); vals.push(email.toLowerCase().trim()); }
    if (role && validRoles.includes(role)) { fields.push(`role = $${i++}`); vals.push(role); }
    if (!fields.length) return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    vals.push(parseInt(id));
    const { rows } = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, name, email, role, created_at`,
      vals
    );
    if (!rows.length) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/users/:id/password — alterar senha
router.put('/:id/password', requireAuth, requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ message: 'Senha deve ter ao menos 6 caracteres.' });
  }
  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const { rowCount } = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, parseInt(req.params.id)]
    );
    if (!rowCount) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/users/:id/send-reminder — enviar link de redefinição de senha
router.post('/:id/send-reminder', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [parseInt(req.params.id)]);
    if (!rows.length) return res.status(404).json({ message: 'Usuário não encontrado.' });
    const user = rows[0];

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [token, expires, user.id]
    );

    const resetUrl = `${APP_URL}/reset?token=${token}`;
    const mailer = await getMailer();

    if (mailer) {
      const { rows: smtpRows } = await pool.query("SELECT value FROM settings WHERE key = 'smtp_config'");
      const smtp = smtpRows[0]?.value;
      await mailer.sendMail({
        from: smtp ? `${smtp.from_name} <${smtp.from_email}>` : `Poisson ERP <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: 'Lembrete: Redefina sua senha — Poisson ERP',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto">
            <h2 style="color:#1F2A8A">Olá, ${user.name}!</h2>
            <p>O administrador solicitou a redefinição da sua senha no sistema <strong>Poisson ERP</strong>.</p>
            <div style="margin:24px 0">
              <a href="${resetUrl}" style="display:inline-block;background:#1E88E5;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Redefinir Senha</a>
            </div>
            <p style="color:#999;font-size:12px">O link expira em 24 horas. Se não foi você, ignore este e-mail.</p>
          </div>
        `,
      });
      res.json({ ok: true, sent: true });
    } else {
      // Sem mailer configurado — retorna o link para o admin copiar manualmente
      res.json({ ok: true, sent: false, resetUrl });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/users/:id — excluir usuário
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ message: 'Você não pode excluir sua própria conta.' });
  try {
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
