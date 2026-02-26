require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');

const recordsRouter = require('./src/routes/records');
const metadataRouter = require('./src/routes/metadata');
const filtersRouter = require('./src/routes/filters');
const backupRouter = require('./src/routes/backup');
const crossrefRouter = require('./src/routes/crossref');
const wordpressRouter = require('./src/routes/wordpress');
const filesRouter = require('./src/routes/files');
const uploadsRouter = require('./src/routes/uploads');
const authRouter = require('./src/routes/auth');
const { requireAuth } = require('./src/middleware/authMiddleware');
const cookieParser = require('cookie-parser');
const path = require('path');

const ANEXOS_PATH = process.env.NODE_ENV === 'production'
  ? '/var/www/anexos_individuais'
  : 'C:\\anexos_individuais';

const app = express();

// Servir anexos estaticamente
app.use('/api/anexos', express.static(ANEXOS_PATH));

// Trust reverse proxy (Apache) for rate limiting and real IP detection
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.APP_URL || 'http://localhost:3000', credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '100mb' }));
app.use(fileUpload());

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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Poisson Backend rodando na porta ${PORT}`);
});