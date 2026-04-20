const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');
const { sendEmail } = require('../utils/email');

const BCRYPT_ROUNDS = 12;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Middleware: apenas admins
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ message: 'Acesso restrito a administradores.' });
  }
  next();
};

// GET /api/users — listar todos os usuários
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, whatsapp, orcid, bio, created_at FROM users ORDER BY id ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/users — criar usuário
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role, whatsapp, orcid, bio } = req.body;
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
      'INSERT INTO users (name, email, password_hash, role, whatsapp, orcid, bio, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id, name, email, role, whatsapp, orcid, bio, created_at',
      [name.trim(), email.toLowerCase().trim(), hash, userRole, whatsapp || null, orcid || null, bio || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/users/:id — editar perfil (admin pode editar qualquer um; usuário pode editar a si mesmo)
router.put('/:id', requireAuth, async (req, res) => {
  const { name, email, role, whatsapp, orcid, bio } = req.body;
  const { id } = req.params;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  const isSelf  = req.user.id === parseInt(id);
  if (!isAdmin && !isSelf) return res.status(403).json({ message: 'Acesso negado.' });

  const validRoles = ['admin', 'organizador', 'autor', 'user'];
  try {
    const fields = [];
    const vals = [];
    let i = 1;
    if (name !== undefined)  { fields.push(`name = $${i++}`);     vals.push(name?.trim() || null); }
    if (isAdmin && email)    { fields.push(`email = $${i++}`);    vals.push(email.toLowerCase().trim()); }
    if (isAdmin && role && validRoles.includes(role)) { fields.push(`role = $${i++}`); vals.push(role); }
    if (whatsapp !== undefined) { fields.push(`whatsapp = $${i++}`); vals.push(whatsapp ? whatsapp.trim() : null); }
    if (orcid    !== undefined) { fields.push(`orcid = $${i++}`);    vals.push(orcid ? orcid.trim() : null); }
    if (bio      !== undefined) { fields.push(`bio = $${i++}`);      vals.push(bio || null); }
    if (!fields.length) return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
    vals.push(parseInt(id));
    const { rows } = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, name, email, role, whatsapp, orcid, bio, created_at`,
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

    const subject = 'Lembrete: Redefina sua senha — Poisson ERP';
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1F2A8A">Olá, ${user.name}!</h2>
        <p>O administrador solicitou a redefinição da sua senha no sistema <strong>Poisson ERP</strong>.</p>
        <div style="margin:24px 0">
          <a href="${resetUrl}" style="display:inline-block;background:#1E88E5;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Redefinir Senha</a>
        </div>
        <p style="color:#999;font-size:12px">O link expira em 24 horas. Se não foi você, ignore este e-mail.</p>
      </div>
    `;

    const sent = await sendEmail(pool, {
      to: user.email,
      subject,
      html,
      type: 'password_reminder',
      extra: { name: user.name, reset_url: resetUrl },
    });

    res.json({ ok: true, sent, resetUrl: sent ? undefined : resetUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/users/:id — excluir usuário
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ message: 'Você não pode excluir sua própria conta.' });
  try {
    // Remove dependências de FK antes de deletar
    await pool.query('UPDATE records SET author_id = NULL WHERE author_id = $1', [id]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM user_presence WHERE user_id = $1', [id]).catch(() => {});
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
