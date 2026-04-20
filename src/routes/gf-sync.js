const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
});

const ARTIGOS_PATH = '/home/darly/projeto_poisson_erp/artigos';
const WP_BASE = '/home/darly/poisson.com.br';
const GF_DB = { host: 'localhost', user: 'darly_wp67237', password: 'S]5ZvH8.7p', database: 'darly_wp67237' };

function urlToPath(url) {
  if (!url) return null;
  try { return WP_BASE + decodeURIComponent(new URL(url).pathname); } catch { return null; }
}

function padId(n) { return 'A-' + String(n).padStart(4, '0'); }

function mapStatusPagamento(v) {
  if (!v) return 'Aguardando';
  const s = String(v).toLowerCase();
  if (s === 'completed' || s === 'paid' || s === 'pago') return 'Pago';
  return 'Aguardando';
}

function mapStatusTermo(v) {
  if (!v) return 'Não enviado';
  const s = String(v).trim();
  return ['Completo', 'Incompleto'].includes(s) ? s : 'Não enviado';
}

async function getFields(gf, entryId) {
  const [rows] = await gf.execute(
    'SELECT meta_key, meta_value FROM wp8g_gf_entry_meta WHERE entry_id = ? ORDER BY CAST(meta_key AS DECIMAL(10,4))',
    [entryId]
  );
  const fields = {};
  for (const r of rows) if (r.meta_value !== null && r.meta_value !== '') fields[r.meta_key] = r.meta_value;
  return fields;
}

function buildRecordData(fields, existing) {
  const autores = [
    { nome: fields['69'], email: fields['70'], orcid: fields['134'], mini: fields['71'] },
    { nome: fields['72'], email: fields['73'], orcid: fields['135'], mini: fields['74'] },
    { nome: fields['77'], email: fields['76'], orcid: fields['136'], mini: fields['75'] },
    { nome: fields['80'], email: fields['79'], orcid: fields['137'], mini: fields['78'] },
    { nome: fields['83'], email: fields['82'], orcid: fields['138'], mini: fields['81'] },
    { nome: fields['86'], email: fields['85'], orcid: fields['139'], mini: fields['84'] },
    { nome: fields['89'], email: fields['88'], orcid: fields['140'], mini: fields['87'] },
    { nome: fields['92'], email: fields['91'], orcid: fields['141'], mini: fields['90'] },
    { nome: fields['142'], email: fields['146'], orcid: fields['144'], mini: fields['145'] },
    { nome: fields['152'], email: fields['150'], orcid: fields['151'], mini: fields['149'] },
  ].filter(a => a.nome && a.nome.trim()).map(a => ({
    nome: (a.nome||'').trim(), email: (a.email||'').trim(),
    orcid: (a.orcid||'').trim(), minicurriculo: (a.mini||'').trim(),
  }));

  const avaliacao_dados = {
    status_avaliacao: fields['17'] || 'Pendente',
    data_avaliacao: fields['115'] || null,
    livro_sugerido: fields['23'] || null,
    status_pagamento: mapStatusPagamento(fields['114']),
    taxa_publicacao: fields['123'] || null,
    data_pagamento: fields['130'] || null,
    status_termo: mapStatusTermo(fields['113']),
    consideracoes_avaliadores: fields['112'] || null,
    data_ultimo_contato: fields['132'] || null,
    administrativo: fields['128'] || null,
  };

  const gfData = {
    gf_entry_id: fields['__entry_id__'] || null,
    titulo_artigo: fields['8'] || '',
    titulo_do_documento: fields['8'] || '',
    livro_escolhido: fields['9'] || null,
    observacoes_editora: fields['36'] || null,
    avaliacao_dados,
    data_prevista_publicacao: fields['116'] || null,
    status_publicacao: fields['131'] || null,
    data_publicacao_efetiva: fields['117'] || null,
    livro_publicacao: fields['59'] || null,
    capitulo: fields['58'] || null,
    isbn: fields['57'] || null,
    doi: fields['56'] || null,
    doi_capitulo: fields['55'] || null,
    tipo_certificado: fields['160'] || null,
    conteudo_certificado: fields['159'] || null,
    tipo_publicacao: 'artigo',
    autores_coletanea: autores,
  };

  // Merge: GF fields overwrite existing, ERP-only fields preserved
  if (existing) {
    return {
      ...existing,
      ...gfData,
      // Always preserve ERP-only file fields if not overwritten by GF
      arquivo_artigo: existing.arquivo_artigo || null,
      arquivo_cessao: existing.arquivo_cessao || null,
    };
  }
  return gfData;
}

// GET /api/gf-sync/status — testa conexão e retorna ultima_sync
router.get('/status', async (req, res) => {
  try {
    const gf = await mysql.createConnection(GF_DB);
    const [rows] = await gf.execute('SELECT COUNT(*) as cnt FROM wp8g_gf_entry WHERE form_id = 8 AND status = "active"');
    await gf.end();

    const { rows: syncRows } = await pool.query("SELECT value FROM settings WHERE key = 'gf_ultima_sync'");
    const rawSync = syncRows[0]?.value;
    const ultimaSync = rawSync ? String(rawSync) : null;

    res.json({ connected: true, totalEntries: rows[0].cnt, ultimaSync });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

// POST /api/gf-sync/run — executa sincronização
router.post('/run', async (req, res) => {
  let gf;
  try {
    gf = await mysql.createConnection(GF_DB);

    // Get ultima_sync
    const { rows: syncRows } = await pool.query("SELECT value FROM settings WHERE key = 'gf_ultima_sync'");
    const rawSync = syncRows[0]?.value;
    const ultimaSync = rawSync ? String(rawSync) : null;

    if (!ultimaSync) {
      await gf.end();
      return res.status(400).json({ error: 'Nenhuma sync anterior encontrada. Execute a migração inicial primeiro.' });
    }

    // Find new and updated entries since ultima_sync
    const [newEntries] = await gf.execute(
      "SELECT id, date_created FROM wp8g_gf_entry WHERE form_id = 8 AND status = 'active' AND date_created > ? ORDER BY id ASC",
      [ultimaSync]
    );
    const [updatedEntries] = await gf.execute(
      "SELECT id, date_created FROM wp8g_gf_entry WHERE form_id = 8 AND status = 'active' AND date_updated > ? AND date_created <= ? ORDER BY id ASC",
      [ultimaSync, ultimaSync]
    );

    // Get max existing A- ID to continue numbering
    const { rows: maxRow } = await pool.query("SELECT id FROM records WHERE id LIKE 'A-%' ORDER BY id DESC LIMIT 1");
    let counter = 1;
    if (maxRow.length) {
      counter = parseInt(maxRow[0].id.replace('A-', '')) + 1;
    }

    let created = 0, updated = 0, filesOk = 0;
    const errors = [];

    // Process new entries
    for (const entry of newEntries) {
      const recordId = padId(counter++);
      const fields = await getFields(gf, entry.id);
      fields['__entry_id__'] = String(entry.id);
      const email = (fields['41'] || '').toLowerCase().trim();
      if (!email) continue;

      let authorId = null;
      const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.length) {
        authorId = existing[0].id;
      } else {
        const name = (fields['42.3'] || fields['42'] || email.split('@')[0]).trim();
        const whatsapp = (fields['46'] || '').trim() || null;
        const bio = (fields['43'] || '').trim() || null;
        const escolaridade = (fields['44'] || '').trim() || null;
        const [wpRows] = await gf.execute('SELECT user_pass FROM wp8g_users WHERE user_email = ?', [email]);
        const wpHash = wpRows.length ? wpRows[0].user_pass : null;
        const { rows: newU } = await pool.query(
          "INSERT INTO users (name, email, whatsapp, bio, escolaridade, wp_password_hash, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6,NULL,'autor') RETURNING id",
          [name, email, whatsapp, bio, escolaridade, wpHash]
        );
        authorId = newU[0].id;
      }

      // Copy files
      const destDir = path.join(ARTIGOS_PATH, recordId);
      let arquivo_artigo = null, arquivo_cessao = null;
      if (fields['10']) {
        const src = urlToPath(fields['10']);
        const dest = recordId + '_1-' + path.basename(decodeURIComponent(new URL(fields['10']).pathname));
        if (src && fs.existsSync(src)) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(src, path.join(destDir, dest));
          arquivo_artigo = dest; filesOk++;
        }
      }
      if (fields['11']) {
        const src = urlToPath(fields['11']);
        const dest = recordId + '_2-' + path.basename(decodeURIComponent(new URL(fields['11']).pathname));
        if (src && fs.existsSync(src)) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(src, path.join(destDir, dest));
          arquivo_cessao = dest; filesOk++;
        }
      }

      const data = buildRecordData(fields, null);
      data.arquivo_artigo = arquivo_artigo;
      data.arquivo_cessao = arquivo_cessao;

      try {
        await pool.query(
          'INSERT INTO records (id, author_id, created_at, updated_at, data) VALUES ($1,$2,$3,$3,$4)',
          [recordId, authorId, entry.date_created, JSON.stringify(data)]
        );
        created++;
      } catch (e) {
        errors.push({ gfId: entry.id, reason: e.message });
      }
    }

    // Process updated entries — find their ERP record by matching GF entry ID in data or by sequence
    for (const entry of updatedEntries) {
      // Find the matching ERP record — by gf_entry_id or fallback by GF sequence
      let matchRows = (await pool.query(
        "SELECT id, data FROM records WHERE id LIKE 'A-%' AND data->>'gf_entry_id' = $1 LIMIT 1",
        [String(entry.id)]
      )).rows;

      // Fallback: match by email of first author if gf_entry_id not stored yet
      if (!matchRows.length) {
        const fallbackFields = await getFields(gf, entry.id);
        const email = (fallbackFields['41'] || '').toLowerCase().trim();
        if (email) {
          const res = await pool.query(
            "SELECT id, data FROM records WHERE id LIKE 'A-%' AND LOWER(data->>'autor_artigo') LIKE $1 ORDER BY id DESC LIMIT 1",
            ['%' + email + '%']
          );
          matchRows = res.rows;
        }
      }

      if (!matchRows.length) continue;

      const existing = matchRows[0].data;
      const fields = await getFields(gf, entry.id);
      fields['__entry_id__'] = String(entry.id);

      // Copy any new files
      const recordId = matchRows[0].id;
      const destDir = path.join(ARTIGOS_PATH, recordId);
      let arquivo_artigo = existing.arquivo_artigo;
      let arquivo_cessao = existing.arquivo_cessao;

      if (fields['10'] && !arquivo_artigo) {
        const src = urlToPath(fields['10']);
        const dest = recordId + '_1-' + path.basename(decodeURIComponent(new URL(fields['10']).pathname));
        if (src && fs.existsSync(src)) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(src, path.join(destDir, dest));
          arquivo_artigo = dest; filesOk++;
        }
      }
      if (fields['11'] && !arquivo_cessao) {
        const src = urlToPath(fields['11']);
        const dest = recordId + '_2-' + path.basename(decodeURIComponent(new URL(fields['11']).pathname));
        if (src && fs.existsSync(src)) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(src, path.join(destDir, dest));
          arquivo_cessao = dest; filesOk++;
        }
      }

      const merged = buildRecordData(fields, existing);
      merged.arquivo_artigo = arquivo_artigo;
      merged.arquivo_cessao = arquivo_cessao;

      await pool.query('UPDATE records SET data = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(merged), recordId]);
      updated++;
    }

    // Update gf_ultima_sync
    const now = new Date().toISOString();
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('gf_ultima_sync', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(now)]
    );

    await gf.end();
    res.json({ ok: true, created, updated, filesOk, errors, ultimaSync: now });
  } catch (e) {
    if (gf) await gf.end().catch(() => {});
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
