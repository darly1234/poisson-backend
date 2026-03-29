const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

// Listar todos (ou filtrar por autor se for role 'autor')
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = 'SELECT * FROM records';
    let params = [];
    
    // Se não for admin, filtra pelo autor_id
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      query += ' WHERE author_id = $1';
      params.push(parseInt(req.user.id, 10));
    }
    
    query += ' ORDER BY id ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resumo compacto para carregamento inicial (id + data + created_at)
router.get('/summary', requireAuth, async (req, res) => {
  try {
    let query = 'SELECT id, data, created_at FROM records';
    let params = [];
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      query += ' WHERE author_id = $1';
      params.push(parseInt(req.user.id, 10));
    }
    query += ' ORDER BY id ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buscar um (verificar se o autor tem permissão)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM records WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Não encontrado' });
    
    const record = result.rows[0];
    
    // Verificação de permissão: admin ou dono do registro
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && record.author_id !== parseInt(req.user.id, 10)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar (atribuindo author_id)
router.post('/', requireAuth, async (req, res) => {
  let { id, data } = req.body;
  const author_id = parseInt(req.user.id, 10);

  try {
    // Se não houver ID, gerar automaticamente (I-0001 ou C-0001)
    if (!id || id === 'NOVO-LIVRO') {
      const prefix = (data.tipo_publicacao === 'coletanea') ? 'C-' : 
                     (data.tipo_publicacao === 'artigo') ? 'A-' : 'I-';

      const lastRecord = await pool.query(
        "SELECT id FROM records WHERE id LIKE $1 ORDER BY id DESC LIMIT 1",
        [`${prefix}%`]
      );

      let nextNumber = 1;
      if (lastRecord.rows.length > 0) {
        const match = lastRecord.rows[0].id.match(/\d+/);
        if (match) {
          nextNumber = parseInt(match[0], 10) + 1;
        }
      }

      id = `${prefix}${String(nextNumber).padStart(4, '0')}`;
    }

    const result = await pool.query(
      'INSERT INTO records (id, data, author_id) VALUES ($1, $2, $3) RETURNING *',
      [id, JSON.stringify(data), author_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar
router.put('/:id', requireAuth, async (req, res) => {
  const { data } = req.body;
  
  try {
    // Verificar propriedade se autor
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      const check = await pool.query('SELECT author_id FROM records WHERE id = $1', [req.params.id]);
      if (check.rows.length > 0 && check.rows[0].author_id !== req.user.id) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
    }

    const result = await pool.query(
      'UPDATE records SET data = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [JSON.stringify(data), req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletar
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // Verificar propriedade se autor
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      const check = await pool.query('SELECT author_id FROM records WHERE id = $1', [req.params.id]);
      if (check.rows.length > 0 && check.rows[0].author_id !== req.user.id) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
    }

    await pool.query('DELETE FROM records WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;