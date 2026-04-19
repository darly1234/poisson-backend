/**
 * migrate_gf.js - Migra artigos do Gravity Forms (formulário #8) para o ERP Poisson
 * Uso: node migrate_gf.js [--dry-run] [--limit 5] [--clean]
 *
 * --dry-run : apenas imprime o que seria feito, sem gravar nada
 * --limit N : limita a N entradas (padrão: todas)
 * --clean   : apaga registros A-* e pastas antes de migrar
 */
require('dotenv').config({ path: '/var/www/poisson-backend/.env' });
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const CLEAN = process.argv.includes('--clean');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1]) : null;

const ARTIGOS_PATH = '/home/darly/projeto_poisson_erp/artigos';
const WP_BASE = '/home/darly/poisson.com.br';

const pg = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
});

function urlToPath(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return WP_BASE + decodeURIComponent(u.pathname);
  } catch { return null; }
}

function basename(filePath) {
  return path.basename(filePath || '');
}

function padId(n) {
  return 'A-' + String(n).padStart(4, '0');
}

function mapStatusPagamento(gfVal) {
  if (!gfVal) return 'Aguardando';
  const v = String(gfVal).toLowerCase();
  if (v === 'completed' || v === 'paid' || v === 'pago') return 'Pago';
  if (v === 'pending') return 'Aguardando';
  return gfVal;
}

function mapStatusTermo(gfVal) {
  if (!gfVal) return 'Não enviado';
  const v = String(gfVal).trim();
  if (v === 'Completo') return 'Completo';
  if (v === 'Incompleto') return 'Incompleto';
  return 'Não enviado';
}

async function copyFile(srcPath, destDir, destName, dryRun) {
  if (!srcPath || !fs.existsSync(srcPath)) {
    return { ok: false, reason: 'src not found: ' + srcPath };
  }
  if (!dryRun) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcPath, path.join(destDir, destName));
  }
  return { ok: true, dest: path.join(destDir, destName) };
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('MIGRAÇÃO GF → ERP | ' + (DRY_RUN ? 'DRY-RUN' : 'EXECUÇÃO REAL') + ' | ' + new Date().toISOString());
  console.log('='.repeat(60));

  const gf = await mysql.createConnection({
    host: 'localhost', user: 'darly_wp67237', password: 'S]5ZvH8.7p', database: 'darly_wp67237'
  });

  let query = "SELECT id, date_created FROM wp8g_gf_entry WHERE form_id = 8 AND status = 'active' ORDER BY id ASC";
  if (LIMIT) query += ' LIMIT ' + LIMIT;
  const [entries] = await gf.execute(query);
  console.log('\nTotal de entradas a migrar: ' + entries.length);

  if (CLEAN && !DRY_RUN) {
    console.log('\n[CLEAN] Apagando registros A-* existentes...');
    const { rowCount } = await pg.query("DELETE FROM records WHERE id LIKE 'A-%'");
    console.log('[CLEAN] ' + rowCount + ' registros deletados');
    if (fs.existsSync(ARTIGOS_PATH)) {
      const dirs = fs.readdirSync(ARTIGOS_PATH).filter(d => d.startsWith('A-'));
      for (const d of dirs) fs.rmSync(path.join(ARTIGOS_PATH, d), { recursive: true });
      console.log('[CLEAN] ' + dirs.length + ' pastas removidas');
    }
  }

  let counter = 1;
  let usersCreated = 0, usersReused = 0, filesOk = 0, filesMissing = 0;
  const errors = [];

  for (const entry of entries) {
    const recordId = padId(counter++);
    console.log('\n--- ' + recordId + ' (GF #' + entry.id + ') ---');

    const [metaRows] = await gf.execute(
      'SELECT meta_key, meta_value FROM wp8g_gf_entry_meta WHERE entry_id = ? ORDER BY CAST(meta_key AS DECIMAL(10,4))',
      [entry.id]
    );

    const fields = {};
    for (const row of metaRows) {
      if (row.meta_value !== null && row.meta_value !== '') {
        fields[row.meta_key] = row.meta_value;
      }
    }

    const email = (fields['41'] || '').toLowerCase().trim();
    if (!email) {
      console.log('  SKIP: sem e-mail');
      errors.push({ gfId: entry.id, reason: 'sem e-mail' });
      continue;
    }

    let authorId = null;
    try {
      const { rows: existing } = await pg.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.length) {
        authorId = existing[0].id;
        usersReused++;
        console.log('  Usuário existente id=' + authorId + ' (' + email + ')');
      } else {
        usersCreated++;
        if (DRY_RUN) {
          console.log('  [DRY] Criar usuário: email="' + email + '"');
        } else {
          const name = (fields['42.3'] || fields['42'] || email.split('@')[0]).trim();
          const whatsapp = (fields['46'] || '').trim() || null;
          const bio = (fields['43'] || '').trim() || null;
          const escolaridade = (fields['44'] || '').trim() || null;

          const [wpRows] = await gf.execute('SELECT user_pass FROM wp8g_users WHERE user_email = ?', [email]);
          const wpHash = wpRows.length ? wpRows[0].user_pass : null;

          const { rows: newU } = await pg.query(
            "INSERT INTO users (name, email, whatsapp, bio, escolaridade, wp_password_hash, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6,NULL,'autor') RETURNING id",
            [name, email, whatsapp, bio, escolaridade, wpHash]
          );
          authorId = newU[0].id;
          console.log('  Usuário CRIADO id=' + authorId + ' (' + email + ')');
        }
      }
    } catch (e) {
      console.log('  ERRO usuário: ' + e.message);
      errors.push({ gfId: entry.id, reason: 'user error: ' + e.message });
      continue;
    }

    // Files
    const artigoUrl = fields['10'] || null;
    const cessaoUrl = fields['11'] || null;
    const destDir = path.join(ARTIGOS_PATH, recordId);

    let arquivo_artigo = null, arquivo_cessao = null;

    if (artigoUrl) {
      const srcPath = urlToPath(artigoUrl);
      const origName = basename(artigoUrl);
      const destName = recordId + '_1-' + origName;
      const result = await copyFile(srcPath, destDir, destName, DRY_RUN);
      if (result.ok) { arquivo_artigo = destName; filesOk++; console.log('  Artigo: ' + destName); }
      else { filesMissing++; console.log('  AVISO artigo: ' + result.reason); }
    }

    if (cessaoUrl) {
      const srcPath = urlToPath(cessaoUrl);
      const origName = basename(cessaoUrl);
      const destName = recordId + '_2-' + origName;
      const result = await copyFile(srcPath, destDir, destName, DRY_RUN);
      if (result.ok) { arquivo_cessao = destName; filesOk++; console.log('  Cessão: ' + destName); }
      else { filesMissing++; console.log('  AVISO cessão: ' + result.reason); }
    }

    // Autores coletanea
    const authorGroups = [
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
    ].filter(a => a.nome && a.nome.trim());

    const autores_coletanea = authorGroups.map(a => ({
      nome: (a.nome || '').trim(),
      email: (a.email || '').trim(),
      orcid: (a.orcid || '').trim(),
      minicurriculo: (a.mini || '').trim(),
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

    const recordData = {
      titulo_artigo: fields['8'] || '',
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
      autores_coletanea,
      arquivo_artigo,
      arquivo_cessao,
    };

    console.log('  Título: ' + (recordData.titulo_artigo || '').substring(0, 60));
    console.log('  Autores: ' + autores_coletanea.length);

    if (!DRY_RUN) {
      try {
        const dataSubmissao = entry.date_created;
        await pg.query(
          'INSERT INTO records (id, author_id, created_at, updated_at, data) VALUES ($1, $2, $3, $3, $4) ON CONFLICT (id) DO UPDATE SET data = $4, author_id = $2, updated_at = $3',
          [recordId, authorId, dataSubmissao, JSON.stringify(recordData)]
        );
        console.log('  OK gravado: ' + recordId);
      } catch (e) {
        console.log('  ERRO insert: ' + e.message);
        errors.push({ gfId: entry.id, recordId, reason: e.message });
      }
    } else {
      console.log('  [DRY] Seria gravado: ' + recordId);
    }
  }

  if (!DRY_RUN) {
    await pg.query(
      "INSERT INTO settings (key, value) VALUES ('gf_ultima_sync', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(new Date().toISOString())]
    );
  }

  await gf.end();
  await pg.end();

  console.log('\n' + '='.repeat(60));
  console.log('RESUMO:');
  console.log('  Entradas processadas : ' + entries.length);
  console.log('  Usuários criados     : ' + usersCreated);
  console.log('  Usuários reutilizados: ' + usersReused);
  console.log('  Arquivos copiados    : ' + filesOk);
  console.log('  Arquivos ausentes    : ' + filesMissing);
  console.log('  Erros                : ' + errors.length);
  if (errors.length) {
    console.log('\nERROS:');
    errors.forEach(e => console.log('  GF#' + e.gfId + ' ' + (e.recordId || '') + ': ' + e.reason));
  }
  console.log('='.repeat(60));
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
