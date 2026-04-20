const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

// Garante que as tabelas existem
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id        SERIAL PRIMARY KEY,
        user_id   INTEGER NOT NULL,
        type      VARCHAR(50) DEFAULT 'info',
        title     VARCHAR(255) NOT NULL,
        body      TEXT,
        data      JSONB DEFAULT '{}',
        read      BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_presence (
        user_id   INTEGER PRIMARY KEY,
        email     VARCHAR(255),
        name      VARCHAR(255),
        last_seen TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (e) {
    console.error('[notifications] Erro ao criar tabelas:', e.message);
  }
})();

// ── Presença ──────────────────────────────────────────────────────────────────

// Heartbeat: atualiza presença do usuário logado
router.post('/presence/heartbeat', requireAuth, async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO user_presence (user_id, email, name, last_seen)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id) DO UPDATE SET last_seen = NOW(), name = $3, email = $2
    `, [parseInt(req.user.id, 10), req.user.email, req.user.name]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Retorna presença de todos os usuários (online = visto nos últimos 3 min)
router.get('/presence', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT user_id, email, name, last_seen,
             (NOW() - last_seen) < INTERVAL '3 minutes' AS online
      FROM user_presence
      ORDER BY name
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Notificações ──────────────────────────────────────────────────────────────

// Listar notificações do usuário logado (últimas 50)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [parseInt(req.user.id, 10)]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Contagem de não lidas
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read = FALSE`,
      [parseInt(req.user.id, 10)]
    );
    res.json({ count: rows[0].count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Criar notificação para um usuário (por email)
router.post('/create', requireAuth, async (req, res) => {
  const { targetEmail, type = 'info', title, body, data = {} } = req.body;
  if (!targetEmail || !title) return res.status(400).json({ error: 'targetEmail e title obrigatórios' });
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [targetEmail]);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, type, title, body || '', JSON.stringify(data)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcar uma como lida
router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`,
      [req.params.id, parseInt(req.user.id, 10)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcar todas como lidas
router.post('/read-all', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET read = TRUE WHERE user_id = $1`,
      [parseInt(req.user.id, 10)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
