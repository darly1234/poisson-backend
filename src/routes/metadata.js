const express = require('express');
const router = express.Router();
const pool = require('../db');

// Buscar metadados
router.get('/', async (req, res) => {
  const result = await pool.query('SELECT tabs, fieldBank FROM metadata ORDER BY id DESC LIMIT 1');
  if (result.rows.length === 0) return res.json({ tabs: [], fieldBank: [] });
  res.json({
    tabs: result.rows[0].tabs || [],
    fieldBank: result.rows[0].fieldbank || result.rows[0].fieldBank || []
  });
});

// Salvar metadados
router.post('/', async (req, res) => {
  const { tabs, fieldBank } = req.body;
  const existing = await pool.query('SELECT id FROM metadata LIMIT 1');
  const fieldBankData = fieldBank ? JSON.stringify(fieldBank) : '[]';

  if (existing.rows.length === 0) {
    const result = await pool.query(
      'INSERT INTO metadata (tabs, fieldBank) VALUES ($1, $2) RETURNING *',
      [JSON.stringify(tabs), fieldBankData]
    );
    res.json(result.rows[0]);
  } else {
    const result = await pool.query(
      'UPDATE metadata SET tabs = $1, fieldBank = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [JSON.stringify(tabs), fieldBankData, existing.rows[0].id]
    );
    res.json(result.rows[0]);
  }
});

module.exports = router;