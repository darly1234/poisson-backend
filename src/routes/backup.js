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

  let result = val;

  if (fieldType === 'currency') {
    const num = parseFloat(String(val).replace(/[^\d.,-]/g, '').replace(',', '.'));
    result = isNaN(num) ? val : num;
  } else if (fieldType === 'date') {
    result = moment(val).isValid() ? moment(val).format('DD/MM/YYYY') : val;
  } else if (Array.isArray(val)) {
    if (val.every(item => typeof item === 'string')) result = val.join(', ');
    else result = JSON.stringify(val);
  } else if (typeof val === 'object') {
    result = JSON.stringify(val);
  }

  // Limite do Excel: 32.767 caracteres por célula
  if (typeof result === 'string' && result.length > 32000) {
    return result.substring(0, 32000) + '... [TRUNCADO: LIMITE DO EXCEL EXCEDIDO]';
  }

  return result;
}

// Exportar Excel "Super Backup" (Configurações, Prompts, Usuários, Tudo)
router.get('/export', async (req, res) => {
  try {
    const recordsRes = await pool.query('SELECT * FROM records ORDER BY id ASC');
    const metadataRes = await pool.query('SELECT * FROM metadata LIMIT 1');
    const filtersRes = await pool.query('SELECT * FROM filters');
    const settingsRes = await pool.query('SELECT * FROM settings');
    const usersRes = await pool.query('SELECT * FROM users');
    const logsRes = await pool.query('SELECT * FROM message_logs LIMIT 1000');

    const metadata = metadataRes.rows[0] || { tabs: [], field_bank: [] };
    const records = recordsRes.rows;
    const filters = filtersRes.rows;
    const settings = settingsRes.rows;
    const users = usersRes.rows;
    const logs = logsRes.rows;

    const wb = XLSX.utils.book_new();

    // 1. REGISTROS
    const fieldBank = metadata.fieldBank || metadata.field_bank || metadata.fieldbank || [];
    const techHeader = ['ID', ...fieldBank.map(f => f.id)];
    const labelsHeader = ['ID Interno', ...fieldBank.map(f => f.label || f.id)];

    const rows = records.map(r => {
      const recordRow = [r.id];
      fieldBank.forEach(f => {
        let val = r.data[f.id];
        if (f.type === 'cover' && val && typeof val === 'object') {
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

    // 2. SISTEMA (METADATA)
    const wsMeta = XLSX.utils.aoa_to_sheet([
      ['JSON_METADATA_DO_NOT_EDIT'],
      [JSON.stringify(metadata)]
    ]);
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Sistema');

    // 3. FILTROS
    const wsFilters = XLSX.utils.json_to_sheet(filters.map(f => ({
      id: f.id,
      name: f.name,
      config: JSON.stringify(f.config)
    })));
    XLSX.utils.book_append_sheet(wb, wsFilters, 'Filtros');

    // 4. CONFIGURAÇÕES (Prompts/Templates/Settings)
    const wsSettings = XLSX.utils.json_to_sheet(settings.map(s => {
      let valStr = JSON.stringify(s.value);
      if (valStr.length > 32000) valStr = valStr.substring(0, 32000) + '... [TRUNCADO: LIMITE DO EXCEL EXCEDIDO]';
      return {
        key: s.key,
        value: valStr,
        updated_at: s.updated_at
      };
    }));
    XLSX.utils.book_append_sheet(wb, wsSettings, 'Configuracoes');

    // 5. USUÁRIOS
    const wsUsers = XLSX.utils.json_to_sheet(users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active
    })));
    XLSX.utils.book_append_sheet(wb, wsUsers, 'Usuarios');

    // 6. LOGS (Prompts recentes)
    if (logs.length > 0) {
      const wsLogs = XLSX.utils.json_to_sheet(logs.map(l => {
        let contentStr = l.content || '';
        if (contentStr.length > 32000) contentStr = contentStr.substring(0, 32000) + '... [TRUNCADO: LIMITE DO EXCEL EXCEDIDO]';
        return {
          id: l.id,
          record_id: l.record_id,
          type: l.type,
          content: contentStr,
          created_at: l.created_at
        };
      }));
      XLSX.utils.book_append_sheet(wb, wsLogs, 'LogsMensagens');
    }

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

    // 1. Restaurar Sistema (Metadata)
    if (wb.SheetNames.includes('Sistema')) {
      const sheetMeta = wb.Sheets['Sistema'];
      const metaJsonRaw = sheetMeta['A2']?.v;
      if (metaJsonRaw) {
        const meta = JSON.parse(metaJsonRaw);
        await client.query('DELETE FROM metadata');
        await client.query('INSERT INTO metadata (tabs, field_bank, updated_at) VALUES ($1, $2, NOW())',
          [JSON.stringify(meta.tabs), JSON.stringify(meta.fieldBank || meta.field_bank || meta.fieldbank)]);
      }
    }

    // 2. Restaurar Filtros
    if (wb.SheetNames.includes('Filtros')) {
      const sheetFilters = wb.Sheets['Filtros'];
      const filterRows = XLSX.utils.sheet_to_json(sheetFilters);
      await client.query('DELETE FROM filters');
      for (const f of filterRows) {
        await client.query(
          'INSERT INTO filters (id, name, config, created_at) VALUES ($1, $2, $3, NOW())',
          [f.id, f.name, f.config]
        );
      }
    }

    // 3. Restaurar Registros
    const sheetRecords = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_row_object_array(sheetRecords, { header: 1 });
    const techIds = rows[0];
    const dataRows = rows.slice(2);

    let importedCount = 0;
    for (const dr of dataRows) {
      const recordId = dr[0];
      if (!recordId) continue;

      const recordData = {};
      techIds.forEach((id, index) => {
        if (id === 'ID' || !id) return;
        let val = dr[index];
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

// Fazer backup JSON completo (Snapshot total da VPS)
router.post('/backup-now', async (req, res) => {
  try {
    const { maxBackups = 10 } = req.body;
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });

    const records = await pool.query('SELECT * FROM records ORDER BY id ASC');
    const metadata = await pool.query('SELECT * FROM metadata LIMIT 1');
    const filters = await pool.query('SELECT * FROM filters');
    const settings = await pool.query('SELECT * FROM settings');
    const users = await pool.query('SELECT * FROM users');
    const logs = await pool.query('SELECT * FROM message_logs');

    const backupData = {
      timestamp: new Date().toISOString(),
      records: records.rows,
      metadata: metadata.rows[0] || {},
      filters: filters.rows,
      settings: settings.rows,
      users: users.rows,
      logs: logs.rows
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restaurar TUDO (Logical Restore de todas as tabelas)
router.post('/restore/:filename', async (req, res) => {
  const filePath = path.join(BACKUPS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup não encontrado' });
  }

  const backupData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Limpa tabelas principais
    await client.query('DELETE FROM records');
    await client.query('DELETE FROM filters');
    await client.query('DELETE FROM metadata');
    await client.query('DELETE FROM settings');
    // Obs: Usuários e logs não limpamos para evitar lock-out, a menos que solicitado
    // Mas "Restore Total" implica zerar e subir. Vamos zerar se houver dados no backup.

    // 1. Records
    for (const r of backupData.records) {
      await client.query(
        'INSERT INTO records (id, data, created_at, updated_at) VALUES ($1, $2, $3, $4)',
        [r.id, JSON.stringify(r.data), r.created_at, r.updated_at]
      );
    }

    // 2. Metadata
    if (backupData.metadata) {
      const m = backupData.metadata;
      await client.query('INSERT INTO metadata (tabs, field_bank, updated_at) VALUES ($1, $2, NOW())',
        [JSON.stringify(m.tabs), JSON.stringify(m.field_bank || m.fieldBank || m.fieldbank)]);
    }

    // 3. Filters
    for (const f of backupData.filters) {
      await client.query(
        'INSERT INTO filters (id, name, config, created_at) VALUES ($1, $2, $3, $4)',
        [f.id, f.name, JSON.stringify(f.config), f.created_at]
      );
    }

    // 4. Settings (Prompts/Configs)
    if (backupData.settings) {
      for (const s of backupData.settings) {
        await client.query(
          'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3',
          [s.key, JSON.stringify(s.value), s.updated_at]
        );
      }
    }

    // 5. Users
    if (backupData.users) {
      for (const u of backupData.users) {
        await client.query(
          'INSERT INTO users (id, name, email, password, role, active, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET name=$2, email=$3, role=$5, active=$6',
          [u.id, u.name, u.email, u.password, u.role, u.active, u.created_at]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:filename', async (req, res) => {
  try {
    const filePath = path.join(BACKUPS_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

const { execSync } = require('child_process');

router.get('/disk-info', async (req, res) => {
  try {
    const dfOut = execSync("df -BM / | tail -1").toString().trim();
    const parts = dfOut.split(/\s+/);
    const total = parts[1];
    const avail = parts[3];
    const usePct = parts[4];
    const freePct = 100 - parseInt(usePct);

    let backupsDirSize = '0 KB';
    try {
      const duOut = execSync(`du -sh "${BACKUPS_DIR}" 2>/dev/null || echo "0\t."`).toString().trim();
      backupsDirSize = duOut.split('\t')[0];
    } catch {}

    res.json({ total, free: avail, freePercent: freePct, usedPercent: parseInt(usePct), backupsDirSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Config Backup — Export/Import das configurações do sistema ───────────────

const CONFIG_BACKUP_SCHEMA = 'poisson-config-backup/v1';

router.get('/config-export', async (req, res) => {
  try {
    const [settingsRes, metadataRes, filtersRes, usersRes, slackRes] = await Promise.all([
      pool.query('SELECT key, value, updated_at FROM settings ORDER BY key'),
      pool.query('SELECT tabs, fieldbank FROM metadata ORDER BY id DESC LIMIT 1'),
      pool.query('SELECT id, name, config, created_at FROM filters ORDER BY created_at'),
      pool.query('SELECT id, name, email, role, whatsapp, orcid, bio, created_at FROM users ORDER BY id'),
      pool.query('SELECT id, nome, slack_id, tipo FROM canais_notificacao ORDER BY id').catch(() => ({ rows: [] })),
    ]);

    const meta = metadataRes.rows[0] || {};
    const fieldBank = meta.fieldbank || meta.fieldBank || meta['fieldBank'] || [];
    const tabs = meta.tabs || [];

    const settingsMap = {};
    for (const row of settingsRes.rows) {
      settingsMap[row.key] = { value: row.value, updated_at: row.updated_at };
    }

    const payload = {
      schema: CONFIG_BACKUP_SCHEMA,
      created_at: new Date().toISOString(),
      sections: {
        settings: settingsMap,
        metadata: { tabs, fieldBank },
        filters: filtersRes.rows,
        users: usersRes.rows,
        slack_channels: slackRes.rows,
      },
      stats: {
        settings_count: settingsRes.rows.length,
        tabs_count: tabs.length,
        fields_count: fieldBank.length,
        filters_count: filtersRes.rows.length,
        users_count: usersRes.rows.length,
        slack_channels_count: slackRes.rows.length,
      }
    };

    const timestamp = moment().tz('America/Sao_Paulo').format('YYYY-MM-DD_HH-mm-ss');
    const fileName = `Poisson_ConfigBackup_${timestamp}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('config-export error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/config-import', async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  let payload;
  try {
    payload = JSON.parse(req.files.file.data.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Arquivo JSON inválido' });
  }

  if (payload.schema !== CONFIG_BACKUP_SCHEMA) {
    return res.status(400).json({ error: `Schema inválido: esperado "${CONFIG_BACKUP_SCHEMA}", recebido "${payload.schema}"` });
  }

  let sections;
  try {
    sections = req.body.sections ? JSON.parse(req.body.sections) : ['settings', 'metadata', 'filters', 'slack_channels'];
  } catch (e) {
    sections = ['settings', 'metadata', 'filters', 'slack_channels'];
  }

  const { sections: data } = payload;
  const client = await pool.connect();
  const restored = {};

  try {
    await client.query('BEGIN');

    if (sections.includes('settings') && data.settings) {
      let count = 0;
      for (const [key, entry] of Object.entries(data.settings)) {
        await client.query(
          'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3',
          [key, JSON.stringify(entry.value), entry.updated_at || new Date()]
        );
        count++;
      }
      restored.settings = count;
    }

    if (sections.includes('metadata') && data.metadata) {
      const existing = await client.query('SELECT id FROM metadata LIMIT 1');
      if (existing.rows.length > 0) {
        await client.query(
          'UPDATE metadata SET tabs = $1, fieldbank = $2, updated_at = NOW() WHERE id = $3',
          [JSON.stringify(data.metadata.tabs || []), JSON.stringify(data.metadata.fieldBank || []), existing.rows[0].id]
        );
      } else {
        await client.query(
          'INSERT INTO metadata (tabs, fieldbank, updated_at) VALUES ($1, $2, NOW())',
          [JSON.stringify(data.metadata.tabs || []), JSON.stringify(data.metadata.fieldBank || [])]
        );
      }
      restored.metadata = { tabs: (data.metadata.tabs || []).length, fields: (data.metadata.fieldBank || []).length };
    }

    if (sections.includes('filters') && data.filters) {
      await client.query('DELETE FROM filters');
      for (const f of data.filters) {
        await client.query(
          'INSERT INTO filters (id, name, config, created_at) VALUES ($1, $2, $3, $4)',
          [f.id, f.name, JSON.stringify(f.config), f.created_at || new Date()]
        );
      }
      restored.filters = data.filters.length;
    }

    if (sections.includes('users') && data.users) {
      let count = 0;
      for (const u of data.users) {
        const existing = await client.query('SELECT id FROM users WHERE id = $1', [u.id]);
        if (existing.rows.length > 0) {
          await client.query(
            'UPDATE users SET name=$1, email=$2, role=$3, whatsapp=$4, orcid=$5, bio=$6 WHERE id=$7',
            [u.name, u.email, u.role, u.whatsapp || null, u.orcid || null, u.bio || null, u.id]
          );
        } else {
          await client.query(
            'INSERT INTO users (id, name, email, role, whatsapp, orcid, bio, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [u.id, u.name, u.email, u.role, u.whatsapp || null, u.orcid || null, u.bio || null, u.created_at || new Date()]
          );
        }
        count++;
      }
      restored.users = count;
    }

    if (sections.includes('slack_channels') && data.slack_channels) {
      let count = 0;
      for (const ch of data.slack_channels) {
        await client.query(
          'INSERT INTO canais_notificacao (nome, slack_id, tipo) VALUES ($1, $2, $3) ON CONFLICT (slack_id) DO UPDATE SET nome=$1, tipo=$3',
          [ch.nome, ch.slack_id, ch.tipo]
        ).catch(() => null); // tabela pode não existir
        count++;
      }
      restored.slack_channels = count;
    }

    await client.query('COMMIT');
    res.json({ success: true, restored, backup_created_at: payload.created_at, stats: payload.stats });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('config-import error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/config-preview', async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  try {
    const payload = JSON.parse(req.files.file.data.toString('utf8'));
    if (payload.schema !== CONFIG_BACKUP_SCHEMA) {
      return res.status(400).json({ error: `Schema inválido: "${payload.schema}"` });
    }
    res.json({ valid: true, schema: payload.schema, created_at: payload.created_at, stats: payload.stats });
  } catch (e) {
    res.status(400).json({ error: 'Arquivo JSON inválido ou corrompido' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

router.post('/cron-apply', async (req, res) => {
  const { enabled, intervalHours = 6, maxBackups = 10 } = req.body;
  const CRON_TAG = '# poisson-backup-auto';
  const cronCmd = `0 */${intervalHours} * * * curl -s -X POST http://localhost:3001/api/backup/backup-now -H "Content-Type: application/json" -d '{\"maxBackups\":${maxBackups}}' ${CRON_TAG}`;

  try {
    let current = '';
    try { current = execSync('crontab -l 2>/dev/null').toString(); } catch {}
    const lines = current.split('\n').filter(l => !l.includes(CRON_TAG) && l.trim() !== '');
    if (enabled) lines.push(cronCmd);
    const newCrontab = lines.join('\n') + '\n';
    execSync(`echo ${JSON.stringify(newCrontab)} | crontab -`);

    const configPath = path.join(BACKUPS_DIR, 'cron-config.json');
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ intervalHours, maxBackups, enabled }));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
