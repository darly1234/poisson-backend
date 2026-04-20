const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('express-async-errors');
const express = require('express');
const cors = require('cors');


const recordsRouter = require('./src/routes/records');
const metadataRouter = require('./src/routes/metadata');
const filtersRouter = require('./src/routes/filters');
const backupRouter = require('./src/routes/backup');
const crossrefRouter = require('./src/routes/crossref');
const wordpressRouter = require('./src/routes/wordpress');
const filesRouter = require('./src/routes/files');
const uploadsRouter = require('./src/routes/uploads');
const webhooksRouter = require('./src/routes/webhooks');
const authRouter = require('./src/routes/auth');
const usersRouter = require('./src/routes/users');
const aiRouter = require('./src/routes/ai');
const mediaRouter = require('./src/routes/media');
const mockupAssetsRouter = require('./src/routes/mockup-assets');
const notificationsRouter = require('./src/routes/notifications');
const gfSyncRouter = require('./src/routes/gf-sync');
const { requireAuth } = require('./src/middleware/authMiddleware');
const cookieParser = require('cookie-parser');

const ANEXOS_PATH = process.platform === 'win32'
  ? 'C:\\projeto_poisson_erp'
  : '/home/darly/projeto_poisson_erp';

const VERSION = "v2.93.11";

const app = express();

// Servir anexos estaticamente com log para depuração de crawlers
app.use('/api/anexos', (req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (ua.toLowerCase().includes('facebook') || ua.toLowerCase().includes('meta') || req.url.includes('temp_posts')) {
    console.log(`[Static] Request: ${req.url} | UA: ${ua} | IP: ${req.ip}`);
  }
  next();
}, express.static(ANEXOS_PATH));

// Trust reverse proxy (Apache) for rate limiting and real IP detection
app.set('trust proxy', 1);

const allowedOrigins = [
  process.env.APP_URL,
  'http://localhost:3000',
  'http://72.60.254.10',
  'http://72.60.254.10:3000',
  'https://poisson.com.br',
  'https://www.poisson.com.br',
  'https://individual.poisson.com.br',
  'http://individual.poisson.com.br'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o)) || origin === 'null') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Rotas públicas (sem autenticação)
app.use('/api/auth', authRouter);

app.get('/api/health', async (req, res) => {
  const { Pool } = require('pg');
  const pool = require('./src/db');
  let dbStatus = 'ok';
  try { await pool.query('SELECT 1'); } catch (e) { dbStatus = 'error: ' + e.message; }

  const fs = require('fs');
  const dirStatus = fs.existsSync(ANEXOS_PATH) ? 'exists' : 'missing';

  res.json({
    status: 'ok',
    version: VERSION,
    database: dbStatus,
    anexos_path: ANEXOS_PATH,
    dir_status: dirStatus,
    env: process.env.NODE_ENV
  });
});

// // Proteção JWT em todas as rotas abaixo (DESATIVADO TEMPORARIAMENTE)
// app.use(requireAuth);

app.use('/api/records', recordsRouter);
app.use('/api/metadata', metadataRouter);
app.use('/api/filters', filtersRouter);
app.use('/api/backup', backupRouter);
app.use('/api/crossref', crossrefRouter);
app.use('/api/wordpress', wordpressRouter);
app.use('/api/files', filesRouter);
app.use('/api/upload', uploadsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/ai', aiRouter);
app.use('/api/media', mediaRouter);
app.use('/api/users', usersRouter);
app.use('/api/mockups', mockupAssetsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/gf-sync', gfSyncRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Poisson Backend rodando na porta ${PORT} em 0.0.0.0`);
});

server.timeout = 600000; // 10 minutos para uploads lentos
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;