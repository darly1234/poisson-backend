const express = require('express');
const router = express.Router();
const pool = require('../db');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const moment = require('moment-timezone');

const BACKUPS_DIR = path.join(__dirname, '../../backups');
const EXPORTS_DIR = path.join(__dirname, '../../exports');

// Exportar Excel com timestamp no horário de Brasília
router.get('/export', async (req, res) => {
  const records = await pool.query('SELECT * FROM records ORDER BY id ASC');
  const metadata = await pool.query('SELECT * FROM metadata LIMIT 1');
  const tabs = metadata.rows[0]?.tabs || [];

  const allFieldIds = [...new Set(records.rows.flatMap(r => Object.keys(r.data)))];

  // Mapa fieldId -> label
  const fieldMap = {};
  tabs.forEach(tab => {
    (tab.fields || []).forEach(f => { fieldMap[f.id] = f.label; });
  });

  const headers = ['ID', ...allFieldIds.map(k => fieldMap[k] || k)];
  const rows = records.rows.map(r => [
    r.id,
    ...allFieldIds.map(k => {
      const val = r.data[k];
      return Array.isArray(val) ? val.join(', ') : (val || '');
    })
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Registros');

  const timestamp = moment().tz('America/Sao_Paulo').format('YYYY-MM-DD_HH-mm-ss');
  const fileName = `Poisson_Export_${timestamp}.xlsx`;
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  const filePath = path.join(EXPORTS_DIR, fileName);
  XLSX.writeFile(wb, filePath);

  res.download(filePath, fileName);
});

// Importar Excel
router.post('/import', async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  const file = req.files.file;
  const wb = XLSX.read(file.data, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const id = row['ID'];
      if (!id) continue;
      const data = { ...row };
      delete data['ID'];
      await client.query(
        `INSERT INTO records (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
        [id, JSON.stringify(data)]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, imported: rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Fazer backup do banco agora
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

  // Remove backups antigos mantendo apenas maxBackups
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ name: f, time: fs.statSync(path.join(BACKUPS_DIR, f)).mtime }))
    .sort((a, b) => b.time - a.time);

  files.slice(maxBackups).forEach(f => fs.unlinkSync(path.join(BACKUPS_DIR, f.name)));

  res.json({ success: true, file: fileName, total: Math.min(files.length, maxBackups) });
});

// Listar backups disponíveis
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

// Restaurar backup
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
      await client.query('INSERT INTO metadata (tabs) VALUES ($1)', [JSON.stringify(backupData.metadata.tabs)]);
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

// Deletar um backup específico (NOVO)
router.delete('/:filename', async (req, res) => {
  const filePath = path.join(BACKUPS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado' });
  }
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

// Salvar configurações do cron
router.post('/cron-config', async (req, res) => {
  const { intervalHours, maxBackups } = req.body;
  const configPath = path.join(BACKUPS_DIR, 'cron-config.json');
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ intervalHours, maxBackups }));
  res.json({ success: true });
});

// Ler configurações do cron
router.get('/cron-config', async (req, res) => {
  const configPath = path.join(BACKUPS_DIR, 'cron-config.json');
  if (!fs.existsSync(configPath)) {
    return res.json({ intervalHours: 6, maxBackups: 10 });
  }
  res.json(JSON.parse(fs.readFileSync(configPath, 'utf8')));
});

module.exports = router;