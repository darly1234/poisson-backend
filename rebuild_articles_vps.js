/**
 * rebuild_articles.js - Migração total + Atualização via Excel
 * Roda no ambiente da VPS
 */
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Configs (VPS environment)
const ARTIGOS_PATH = '/home/darly/projeto_poisson_erp/artigos';
const WP_BASE = '/home/darly/poisson.com.br';
const EXCEL_PATH = '/var/www/poisson-backend/PowerP2_-_Editora_Poisson-1.xlsx';

const pgPool = new Pool({
  host: 'localhost', port: 5432,
  database: 'poisson_erp', user: 'postgres', password: 'ylrad320@',
});

function urlToPath(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return WP_BASE + decodeURIComponent(u.pathname);
  } catch { return null; }
}

function padId(n) {
  return 'A-' + String(n).padStart(4, '0');
}

function excelDateToJSDate(serial) {
  if (!serial || isNaN(serial)) return serial;
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toLocaleDateString('pt-BR');
}

async function main() {
  console.log('--- INICIANDO RECONSTRUÇÃO TOTAL DE ARTIGOS ---');

  // 1. Conectar MySQL (Gravity Forms)
  const gf = await mysql.createConnection({
    host: 'localhost', user: 'darly_wp67237', password: 'S]5ZvH8.7p', database: 'darly_wp67237'
  });

  // 2. Limpeza Total
  console.log('[1/4] Limpando registros antigos...');
  await pgPool.query("DELETE FROM records WHERE id LIKE 'A-%'");
  if (fs.existsSync(ARTIGOS_PATH)) {
    const dirs = fs.readdirSync(ARTIGOS_PATH).filter(d => d.startsWith('A-'));
    for (const d of dirs) fs.rmSync(path.join(ARTIGOS_PATH, d), { recursive: true });
  }

  // 3. Migração Inicial (GF -> PG)
  console.log('[2/4] Migrando artigos do Gravity Forms (Form 8)...');
  const [entries] = await gf.execute("SELECT id, date_created FROM wp8g_gf_entry WHERE form_id = 8 AND status = 'active' ORDER BY id ASC");
  
  let counter = 1;
  for (const entry of entries) {
    const recordId = padId(counter++);
    const [metaRows] = await gf.execute('SELECT meta_key, meta_value FROM wp8g_gf_entry_meta WHERE entry_id = ?', [entry.id]);
    const fields = {};
    metaRows.forEach(r => { if(r.meta_value) fields[r.meta_key] = r.meta_value; });

    const email = (fields['41'] || '').toLowerCase().trim();
    if (!email) continue;

    // Buscar Author ID
    const { rows: userRows } = await pgPool.query('SELECT id FROM users WHERE email = $1', [email]);
    let authorId = userRows.length ? userRows[0].id : null;
    if (!authorId) {
      // Criar usuário se não existir (autor)
      const name = (fields['42.3'] || fields['42'] || email.split('@')[0]).trim();
      const { rows: newU } = await pgPool.query("INSERT INTO users (name, email, role) VALUES ($1,$2,'autor') RETURNING id", [name, email]);
      authorId = newU[0].id;
    }

    // Mapeamento básico (conforme migrate_gf.js original)
    const authorGroups = [
      { nome: fields['69'], email: fields['70'], orcid: fields['134'], mini: fields['71'] },
      { nome: fields['72'], email: fields['73'], orcid: fields['135'], mini: fields['74'] },
      { nome: fields['77'], email: fields['76'], orcid: fields['136'], mini: fields['75'] },
      { nome: fields['80'], email: fields['79'], orcid: fields['137'], mini: fields['78'] },
      { nome: fields['83'], email: fields['82'], orcid: fields['138'], mini: fields['81'] },
    ].filter(a => a.nome);

    const recordData = {
      titulo_artigo: fields['8'] || '',
      livro_escolhido: fields['9'] || null,
      tipo_publicacao: 'artigo',
      autores_coletanea: authorGroups.map(a => ({
        nome: a.nome.trim(), email: (a.email||'').trim(), orcid: (a.orcid||'').trim(), minicurriculo: (a.mini||'').trim()
      })),
      gf_entry_id: String(entry.id)
    };

    // Copiar arquivos (simplificado)
    const destDir = path.join(ARTIGOS_PATH, recordId);
    if (fields['10']) {
      const src = urlToPath(fields['10']);
      if (src && fs.existsSync(src)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, path.join(destDir, recordId + '_1-' + path.basename(src)));
        recordData.arquivo_artigo = recordId + '_1-' + path.basename(src);
      }
    }
    if (fields['11']) {
      const src = urlToPath(fields['11']);
      if (src && fs.existsSync(src)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, path.join(destDir, recordId + '_2-' + path.basename(src)));
        recordData.arquivo_cessao = recordId + '_2-' + path.basename(src);
      }
    }

    await pgPool.query('INSERT INTO records (id, author_id, created_at, updated_at, data) VALUES ($1,$2,$3,$3,$4)', 
      [recordId, authorId, entry.date_created, JSON.stringify(recordData)]);
  }
  console.log(`Migrados ${counter - 1} artigos.`);

  // 4. Atualização via Excel
  console.log('[3/4] Aplicando dados do Excel...');
  if (fs.existsSync(EXCEL_PATH)) {
    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const excelData = XLSX.utils.sheet_to_json(sheet);
    let updated = 0;

    for (const row of excelData) {
      const id = row['ID'];
      if (!id) continue;

      const { rows: match } = await pgPool.query('SELECT data FROM records WHERE id = $1', [id]);
      if (match.length) {
        const data = match[0].data;
        data.livro_publicacao = row['Nome do Livro'] || data.livro_publicacao;
        data.capitulo = row['Capítulo'] || data.capitulo;
        data.isbn = row['ISBN'] || data.isbn;
        data.doi_capitulo = row['Doi do capítulo'] || data.doi_capitulo;
        data.data_publicacao_efetiva = excelDateToJSDate(row['Data de Publicação']) || data.data_publicacao_efetiva;
        data.status_publicacao = row['Status da Publicação'] || data.status_publicacao;
        
        // Garante que o livro escolhido também seja atualizado se necessário
        if (row['Nome do Livro']) data.livro_escolhido = row['Nome do Livro'];

        await pgPool.query('UPDATE records SET data = $1 WHERE id = $2', [JSON.stringify(data), id]);
        updated++;
      }
    }
    console.log(`Atualizados ${updated} registros via Excel.`);
  } else {
    console.log('AVISO: Arquivo Excel não encontrado em ' + EXCEL_PATH);
  }

  // 5. Finalizar
  console.log('[4/4] Finalizando...');
  await gf.end();
  await pgPool.end();
  console.log('--- RECONSTRUÇÃO CONCLUÍDA COM SUCESSO ---');
}

main().catch(err => { console.error('ERRO FATAL:', err); process.exit(1); });
