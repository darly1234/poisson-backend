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

const app = express();

app.use(cors());
app.use(express.json());
app.use(fileUpload());

app.use('/api/records', recordsRouter);
app.use('/api/metadata', metadataRouter);
app.use('/api/filters', filtersRouter);
app.use('/api/backup', backupRouter);
app.use('/api/crossref', crossrefRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Poisson Backend rodando na porta ${PORT}`);
});