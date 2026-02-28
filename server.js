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
const { requireAuth } = require('./src/middleware/authMiddleware');
const cookieParser = require('cookie-parser');

const ANEXOS_PATH = process.env.NODE_ENV === 'production'
  ? '/var/www/anexos_individuais'
  : 'C:\\anexos_individuais';

const app = express();

// Servir anexos estaticamente
app.use('/api/anexos', express.static(ANEXOS_PATH));

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
      console.warn('[CORS DEBUG] Blocked:', origin);
      callback(null, true); // Temporariamente permitir tudo para debug
    }
  },
  credentials: true
}));

app.use((req, res, next) => {
  if (req.url.includes('/api/')) {
    console.log(`[REQUEST DEBUG] ${req.method} ${req.url} - Origin: ${req.headers.origin}`);
  }
  next();
});

app.use(cookieParser());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Rotas públicas (sem autenticação)
app.use('/api/auth', authRouter);

// Proteção JWT em todas as rotas abaixo
app.use(requireAuth);

app.use('/api/records', recordsRouter);
app.use('/api/metadata', metadataRouter);
app.use('/api/filters', filtersRouter);
app.use('/api/backup', backupRouter);
app.use('/api/crossref', crossrefRouter);
app.use('/api/wordpress', wordpressRouter);
app.use('/api/files', filesRouter);
app.use('/api/upload', uploadsRouter);
app.use('/api/webhooks', webhooksRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Poisson Backend rodando na porta ${PORT}`);
});