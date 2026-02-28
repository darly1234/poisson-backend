const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fileUpload = require('express-fileupload');

function normalizeFilename(name) {
    if (!name) return '';
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ç/g, 'c')
        .replace(/Ç/g, 'C')
        .replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

const ANEXOS_PATH = process.env.NODE_ENV === 'production'
    ? '/var/www/anexos_individuais'
    : 'C:\\anexos_individuais';

// Garante que a pasta existe (redundância de segurança)
if (!fs.existsSync(ANEXOS_PATH)) {
    fs.mkdirSync(ANEXOS_PATH, { recursive: true });
}

router.use(fileUpload());

router.post('/', async (req, res) => {
    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const { id } = req.body; // ID do livro (ex: I-001 ou DRAFT)
    const file = req.files.file;

    // Lista arquivos na pasta para determinar o próximo sequencial para este ID
    const files = fs.readdirSync(ANEXOS_PATH);
    const idPrefix = `${id}-`;
    const count = files.filter(f => f.startsWith(idPrefix)).length;
    const nextSeq = count + 1;

    // Padronização do Nome: ID-N_NomeOriginal
    // Removemos caracteres estranhos do nome original para evitar problemas de URL
    const safeName = normalizeFilename(file.name);
    const newFileName = `${id}-${nextSeq}_${safeName}`;
    const uploadPath = path.join(ANEXOS_PATH, newFileName);

    await file.mv(uploadPath);

    // Retorna a URL pública para o frontend
    res.json({
        success: true,
        name: newFileName,
        url: `/api/anexos/${newFileName}`
    });
});

module.exports = router;
