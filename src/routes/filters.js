const express = require('express');
const router = express.Router();
const pool = require('../db');

// Listar todos
router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM filters ORDER BY created_at ASC');
  res.json(result.rows);
});

// Criar
router.post('/', async (req, res) => {
  const { id, name, config } = req.body;
  const result = await pool.query(
    'INSERT INTO filters (id, name, config) VALUES ($1, $2, $3) RETURNING *',
    [id, name, JSON.stringify(config)]
  );
  res.json(result.rows[0]);
});

// Atualizar
router.put('/:id', async (req, res) => {
  const { name, config } = req.body;
  const result = await pool.query(
    'UPDATE filters SET name = $1, config = $2 WHERE id = $3 RETURNING *',
    [name, JSON.stringify(config), req.params.id]
  );
  res.json(result.rows[0]);
});

// Deletar
router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM filters WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;