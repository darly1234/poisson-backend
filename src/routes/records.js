const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

// Helper: verifica se role é privilegiada (vê tudo)
const isPrivilegedRole = (role) => ['admin', 'superadmin', 'organizador'].includes(role);

// Filtro SQL: registros onde o usuário é submissor OU está listado como autor pelo email
const authorFilter = `
  (r.author_id = $1
   OR EXISTS (
     SELECT 1 FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(r.data->'autores_coletanea') = 'array'
            THEN r.data->'autores_coletanea'
            ELSE '[]'::jsonb END
     ) AS a
     WHERE lower(a->>'email') = lower($2)
   )
  )
`;

// Listar registros (admins veem tudo; autor/usuario veem apenas os seus)
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = `
      SELECT r.*,
             u.name as author_name, u.email as author_email, u.role as author_role, u.whatsapp as author_whatsapp, u.orcid as author_orcid
      FROM records r
      LEFT JOIN users u ON r.author_id = u.id
    `;
    let params = [];

    if (!isPrivilegedRole(req.user.role)) {
      query += ` WHERE ${authorFilter}`;
      params.push(parseInt(req.user.id, 10), req.user.email);
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
    let query = `
      SELECT r.id, r.data, r.created_at, r.author_id,
             u.name as author_name, u.email as author_email, u.role as author_role, u.whatsapp as author_whatsapp, u.orcid as author_orcid
      FROM records r
      LEFT JOIN users u ON r.author_id = u.id
    `;
    let params = [];
    if (!isPrivilegedRole(req.user.role)) {
      query += ` WHERE ${authorFilter}`;
      params.push(parseInt(req.user.id, 10), req.user.email);
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
    const result = await pool.query(`
      SELECT r.*, 
             u.name as author_name, u.email as author_email, u.role as author_role, u.whatsapp as author_whatsapp, u.orcid as author_orcid
      FROM records r
      LEFT JOIN users u ON r.author_id = u.id
      WHERE r.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Não encontrado' });
    
    const record = result.rows[0];
    
    // Privilegiados veem tudo; outros só veem se são submissor ou estão nos autores pelo email
    if (!isPrivilegedRole(req.user.role)) {
      const isSubmitter = record.author_id === parseInt(req.user.id, 10);
      const autores = Array.isArray(record.data?.autores_coletanea) ? record.data.autores_coletanea : [];
      const isCoAuthor = autores.some(a => a?.email?.toLowerCase() === req.user.email?.toLowerCase());
      if (!isSubmitter && !isCoAuthor) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
    }
    
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar (atribuindo author_id)
router.post('/', requireAuth, async (req, res) => {
  let { id, data, author_id } = req.body;
  
  // Se for admin e passou author_id, usa ele. Se não, usa o ID do próprio usuário logado.
  const final_author_id = (req.user.role === 'admin' || req.user.role === 'superadmin') 
    ? (parseInt(author_id, 10) || parseInt(req.user.id, 10))
    : parseInt(req.user.id, 10);

  try {
    // Se não houver ID, gerar automaticamente (I-0001 ou C-0001)
    if (!id || id === 'NOVO-LIVRO' || id === 'NOVO-ARTIGO') {
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
      [id, JSON.stringify(data), final_author_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar
router.put('/:id', requireAuth, async (req, res) => {
  const { data, author_id } = req.body;

  try {
    // Edição: apenas o submissor original (author_id) pode editar — nunca co-autores
    if (!isPrivilegedRole(req.user.role)) {
      const check = await pool.query('SELECT author_id FROM records WHERE id = $1', [req.params.id]);
      if (check.rows.length === 0) return res.status(404).json({ error: 'Não encontrado' });
      if (check.rows[0].author_id !== parseInt(req.user.id, 10)) {
        return res.status(403).json({ error: 'Apenas o autor que submeteu pode editar este artigo.' });
      }
    }

    let final_author_id = author_id;
    let query = 'UPDATE records SET data = $1, updated_at = NOW()';
    let params = [JSON.stringify(data), req.params.id];

    // Se for admin e passar author_id, atualiza também a propriedade
    if ((req.user.role === 'admin' || req.user.role === 'superadmin') && author_id !== undefined) {
      query = 'UPDATE records SET data = $1, author_id = $3, updated_at = NOW()';
      params = [JSON.stringify(data), req.params.id, parseInt(author_id, 10)];
    }

    console.log(`[Backend] Atualizando registro ${req.params.id}. Data entries:`, Object.keys(data || {}));

    const result = await pool.query(
      query + ' WHERE id = $2 RETURNING *',
      params
    );
    
    if (result.rows.length > 0) {
      console.log(`[Backend] Registro ${req.params.id} atualizado com sucesso.`);
    } else {
      console.warn(`[Backend] Falha ao atualizar: Registro ${req.params.id} não encontrado.`);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(`[Backend] Erro ao atualizar ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// Deletar
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // Delete: apenas submissor ou admin
    if (!isPrivilegedRole(req.user.role)) {
      const check = await pool.query('SELECT author_id FROM records WHERE id = $1', [req.params.id]);
      if (check.rows.length === 0) return res.status(404).json({ error: 'Não encontrado' });
      if (check.rows[0].author_id !== parseInt(req.user.id, 10)) {
        return res.status(403).json({ error: 'Apenas o autor que submeteu pode excluir este artigo.' });
      }
    }

    await pool.query('DELETE FROM records WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;