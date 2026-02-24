const express = require('express');
const router = express.Router();
const pool = require('../db');

// Listar todos
router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM records ORDER BY id ASC');
  res.json(result.rows);
});

// Buscar um
router.get('/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM records WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Não encontrado' });
  res.json(result.rows[0]);
});

// Criar
router.post('/', async (req, res) => {
  const { id, data } = req.body;
  const result = await pool.query(
    'INSERT INTO records (id, data) VALUES ($1, $2) RETURNING *',
    [id, JSON.stringify(data)]
  );
  res.json(result.rows[0]);
});

// Atualizar
router.put('/:id', async (req, res) => {
  const { data } = req.body;
  const result = await pool.query(
    'UPDATE records SET data = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [JSON.stringify(data), req.params.id]
  );
  res.json(result.rows[0]);
});

// Deletar
router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM records WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;