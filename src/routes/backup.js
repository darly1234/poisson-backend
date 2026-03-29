const express = require('express');
const router = express.Router();
const pool = require('../db');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const moment = require('moment-timezone');
const fileUpload = require('express-fileupload');

router.use(fileUpload());

const BACKUPS_DIR = '/home/darly/projeto_poisson_erp/backup';
const EXPORTS_DIR = '/home/darly/projeto_poisson_erp/exports';

// Helper formatador para Excel
function formatValueForExcel(val, fieldType) {
  if (val === null || val === undefined) return '';

  if (fieldType === 'currency') {
    const num = parseFloat(String(val).replace(/[^\d.,-]/g, '').replace(',', '.'));
    return isNaN(num) ? val : num;
  }

  if (fieldType === 'date') {
    return moment(val).isValid() ? moment(val).format('DD/MM/YYYY') : val;
  }

  if (Array.isArray(val)) {
    // Se for array de strings (tags, autores formatados, etc)
    if (val.every(item => typeof item === 'string')) return val.join(', ');
    // Se for array de objetos (Provavelmente arquivos ou autores complexos)
    return JSON.stringify(val);
  }

  if (typeof val === 'object') return JSON.stringify(val);

  return val;
}

// Exportar Excel "Super Backup"
router.get('/export', async (req, res) => {
  try {
    const recordsRes = await pool.query('SELECT * FROM records ORDER BY id ASC');
    const metadataRes = await pool.query('SELECT * FROM metadata LIMIT 1');
    const filtersRes = await pool.query('SELECT * FROM filters');

    const metadata = metadataRes.rows[0] || { tabs: [], fieldBank: [] };
    const records = recordsRes.rows;
    const filters = filtersRes.rows;

    const wb = XLSX.utils.book_new();

    // --- ABA 1: REGISTROS ---
    const fieldBank = metadata.fieldBank || [];
    // Cabeçalhos (Linha 1: IDs técnicos, Linha 2: Labels visíveis)
    const techHeader = ['ID', ...fieldBank.map(f => f.id)];
    const labelsHeader = ['ID Interno', ...fieldBank.map(f => f.label || f.id)];

    const rows = records.map(r => {
      const recordRow = [r.id];
      fieldBank.forEach(f => {
        let val = r.data[f.id];

        // Trata Links de Arquivos (Cover Field ou Generic File)
        if (f.type === 'cover' && val && typeof val === 'object') {
          // Simplifica para o Excel mostrando o caminho ou URL se disponível
          const links = [];
          if (val.front) links.push(val.front.url || (typeof val.front === 'string' ? val.front : 'Capa Frontal'));
          if (val.back) links.push(val.back.url || 'Contracapa');
          if (val.x) links.push(val.x.url || 'Arquivo Extra');
          val = links.join(' | ');
        } else if (f.type === 'file' && Array.isArray(val)) {
          val = val.map(file => file.url || file).join(' | ');
        } else {
          val = formatValueForExcel(val, f.type);
        }
        recordRow.push(val);
      });
      return recordRow;
    });

    const wsRecords = XLSX.utils.aoa_to_sheet([techHeader, labelsHeader, ...rows]);
    XLSX.utils.book_append_sheet(wb, wsRecords, 'Registros');

    // --- ABA 2: SISTEMA (METADATA) ---
    // Salvamos o JSON bruto em uma célula para garantir 100% de paridade
    const wsMeta = XLSX.utils.aoa_to_sheet([
      ['JSON_METADATA_DO_NOT_EDIT'],
      [JSON.stringify(metadata)]
    ]);
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Sistema');

    // --- ABA 3: FILTROS ---
    const wsFilters = XLSX.utils.json_to_sheet(filters.map(f => ({
      id: f.id,
      name: f.name,
      config: JSON.stringify(f.config)
    })));
    XLSX.utils.book_append_sheet(wb, wsFilters, 'Filtros');

    const timestamp = moment().tz('America/Sao_Paulo').format('YYYY-MM-DD_HH-mm-ss');
    const fileName = `Poisson_SuperBackup_${timestamp}.xlsx`;
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    const filePath = path.join(EXPORTS_DIR, fileName);
    XLSX.writeFile(wb, filePath);

    res.download(filePath, fileName);
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao gerar exportação: ' + err.message);
  }
});

// Importar Excel "Super Backup"
router.post('/import', async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const file = req.files.file;
  const wb = XLSX.read(file.data, { type: 'buffer' });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Restaurar Sistema (Metadata) se a aba existir
    if (wb.SheetNames.includes('Sistema')) {
      const sheetMeta = wb.Sheets['Sistema'];
      const metaJsonRaw = sheetMeta['A2']?.v;
      if (metaJsonRaw) {
        const meta = JSON.parse(metaJsonRaw);
        await client.query('DELETE FROM metadata');
        await client.query('INSERT INTO metadata (tabs, field_bank, updated_at) VALUES ($1, $2, NOW())',
          [JSON.stringify(meta.tabs), JSON.stringify(meta.fieldBank)]);
        console.log('✓ Metadata restored during import');
      }
    }

    // 2. Restaurar Filtros se a aba existir
    if (wb.SheetNames.includes('Filtros')) {
      const sheetFilters = wb.Sheets['Filtros'];
      const filterRows = XLSX.utils.sheet_to_json(sheetFilters);
      await client.query('DELETE FROM filters'); // Limpa para evitar duplicatas ID
      for (const f of filterRows) {
        await client.query(
          'INSERT INTO filters (id, name, config, created_at) VALUES ($1, $2, $3, NOW())',
          [f.id, f.name, f.config]
        );
      }
      console.log('✓ Filters restored during import');
    }

    // 3. Restaurar Registros (Aba principal)
    const sheetRecords = wb.Sheets[wb.SheetNames[0]]; // Assume a primeira aba se não for 'Registros'
    const rows = XLSX.utils.sheet_to_row_object_array(sheetRecords, { header: 1 });

    const techIds = rows[0]; // Linha 1 tem os IDs técnicos (f_title, etc)
    const dataRows = rows.slice(2); // Pula linha 1 (ID) e linha 2 (Label)

    let importedCount = 0;
    for (const dr of dataRows) {
      const recordId = dr[0];
      if (!recordId) continue;

      const recordData = {};
      techIds.forEach((id, index) => {
        if (id === 'ID' || !id) return;
        let val = dr[index];

        // Tenta fazer parse de JSON se parecer um (para campos complexos)
        if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
          try { val = JSON.parse(val); } catch (e) { }
        }
        recordData[id] = val;
      });

      await client.query(
        `INSERT INTO records (id, data, updated_at) VALUES ($1, $2, NOW()) 
                 ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
        [recordId, JSON.stringify(recordData)]
      );
      importedCount++;
    }

    await client.query('COMMIT');
    res.json({ success: true, imported: importedCount, sheets: wb.SheetNames });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro na importação:', err);
    res.status(500).json({ error: 'Erro na importação: ' + err.message });
  } finally {
    client.release();
  }
});

// Fazer backup do banco agora (JSON bruto legado mantido para retrocompatibilidade)
router.post('/backup-now', async (req, res) => {
  const { maxBackups = 10 } = req.body;
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  const records = await pool.query('SELECT * FROM records ORDER BY id ASC');
  const metadata = await pool.query('SELECT * FROM metadata LIMIT 1');
  const filters = await pool.query('SELECT * FROM filters');

  const backupData = {
    timestamp: new Date().toISOString(),
    records: records.rows,
    metadata: metadata.rows[0] || {},
    filters: filters.rows
  };

  const timestamp = moment().tz('America/Sao_Paulo').format('YYYY-MM-DD_HH-mm-ss');
  const fileName = `backup_${timestamp}.json`;
  const filePath = path.join(BACKUPS_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));

  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ name: f, time: fs.statSync(path.join(BACKUPS_DIR, f)).mtime }))
    .sort((a, b) => b.time - a.time);

  files.slice(maxBackups).forEach(f => fs.unlinkSync(path.join(BACKUPS_DIR, f.name)));

  res.json({ success: true, file: fileName, total: Math.min(files.length, maxBackups) });
});

router.get('/list', async (req, res) => {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      size: (fs.statSync(path.join(BACKUPS_DIR, f)).size / 1024).toFixed(1) + ' KB',
      date: fs.statSync(path.join(BACKUPS_DIR, f)).mtime
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(files);
});

router.post('/restore/:filename', async (req, res) => {
  const filePath = path.join(BACKUPS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup não encontrado' });
  }

  const backupData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM records');
    await client.query('DELETE FROM filters');

    for (const record of backupData.records) {
      await client.query(
        'INSERT INTO records (id, data, created_at, updated_at) VALUES ($1, $2, $3, $4)',
        [record.id, JSON.stringify(record.data), record.created_at, record.updated_at]
      );
    }

    if (backupData.metadata?.tabs) {
      await client.query('DELETE FROM metadata');
      await client.query('INSERT INTO metadata (tabs, field_bank, updated_at) VALUES ($1, $2, NOW())',
        [JSON.stringify(backupData.metadata.tabs), JSON.stringify(backupData.metadata.fieldBank || backupData.metadata.field_bank)]);
    }

    for (const filter of backupData.filters) {
      await client.query(
        'INSERT INTO filters (id, name, config, created_at) VALUES ($1, $2, $3, $4)',
        [filter.id, filter.name, JSON.stringify(filter.config), filter.created_at]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:filename', async (req, res) => {
  const filePath = path.join(BACKUPS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado' });
  }
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

router.post('/cron-config', async (req, res) => {
  const { intervalHours, maxBackups } = req.body;
  const configPath = path.join(BACKUPS_DIR, 'cron-config.json');
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ intervalHours, maxBackups }));
  res.json({ success: true });
});

router.get('/cron-config', async (req, res) => {
  const configPath = path.join(BACKUPS_DIR, 'cron-config.json');
  if (!fs.existsSync(configPath)) {
    return res.json({ intervalHours: 6, maxBackups: 10 });
  }
  res.json(JSON.parse(fs.readFileSync(configPath, 'utf8')));
});

// Patch para adicionar ao final do backup.js (antes de module.exports)
// Dois novos endpoints: /disk-info e /cron-apply

const { execSync } = require('child_process');

// GET /disk-info — espaço em disco da VPS + tamanho dos backups
router.get('/disk-info', async (req, res) => {
  try {
    const dfOut = execSync("df -BM / | tail -1").toString().trim();
    const parts = dfOut.split(/\s+/);
    // parts: Filesystem, Size, Used, Avail, Use%, Mounted
    const total = parts[1];
    const avail = parts[3];
    const usePct = parts[4]; // ex: "68%"
    const freePct = 100 - parseInt(usePct);

    let backupsDirSize = '0 KB';
    try {
      const duOut = execSync(`du -sh "${BACKUPS_DIR}" 2>/dev/null || echo "0\t."`).toString().trim();
      backupsDirSize = duOut.split('\t')[0];
    } catch {}

    res.json({
      total,
      free: avail,
      freePercent: freePct,
      usedPercent: parseInt(usePct),
      backupsDirSize
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /cron-apply — escreve ou remove entrada no crontab do root
router.post('/cron-apply', async (req, res) => {
  const { enabled, intervalHours = 6, maxBackups = 10 } = req.body;
  const CRON_TAG = '# poisson-backup-auto';
  const cronCmd = `0 */${intervalHours} * * * curl -s -X POST http://localhost:3001/api/backup/backup-now -H "Content-Type: application/json" -d '{"maxBackups":${maxBackups}}' ${CRON_TAG}`;

  try {
    // Lê crontab atual (ignora erro se estiver vazio)
    let current = '';
    try { current = execSync('crontab -l 2>/dev/null').toString(); } catch {}

    // Remove linha antiga do poisson se existir
    const lines = current.split('\n').filter(l => !l.includes(CRON_TAG) && l.trim() !== '');

    if (enabled) lines.push(cronCmd);

    const newCrontab = lines.join('\n') + '\n';
    execSync(`echo ${JSON.stringify(newCrontab)} | crontab -`);

    // Salva config no arquivo também
    const configPath = path.join(BACKUPS_DIR, 'cron-config.json');
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ intervalHours, maxBackups, enabled }));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
