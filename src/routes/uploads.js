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

const BASE_PATH = process.platform === 'win32'
    ? 'C:\\projeto_poisson_erp'
    : '/home/darly/projeto_poisson_erp';

// Determina subpasta com base no prefixo do ID
function getSubfolder(id) {
    if (!id) return 'diversos';
    if (id.startsWith('A-')) return 'artigos';
    if (id.startsWith('I-') || id.startsWith('C-')) return 'livros';
    return 'diversos';
}

router.use(fileUpload());

router.post('/', async (req, res) => {
    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const { id } = req.body; // ID do registro (ex: I-0010, A-0001, DRAFT)
    const file = req.files.file;

    const subfolder = getSubfolder(id);
    const recordDir = path.join(BASE_PATH, subfolder, id || 'diversos');
    console.log(`[Uploads] Base Path: ${BASE_PATH}, Subfolder: ${subfolder}, ID: ${id}`);
    console.log(`[Uploads] Target Directory: ${recordDir}`);

    // Garante que a pasta do registro existe
    try {
        if (!fs.existsSync(recordDir)) {
            console.log(`[Uploads] Creating directory: ${recordDir}`);
            fs.mkdirSync(recordDir, { recursive: true });
        }
    } catch (e) {
        console.error('[Uploads] Error creating directory:', e);
    }

    // Lista arquivos na pasta para determinar o próximo sequencial para este ID
    let count = 0;
    try {
        const filesExists = fs.readdirSync(recordDir);
        const idPrefix = `${id}-`;
        count = filesExists.filter(f => f.startsWith(idPrefix)).length;
    } catch (e) { }
    const nextSeq = count + 1;

    // Padronização do Nome: ID-N_NomeOriginal
    const safeName = normalizeFilename(file.name);
    const newFileName = `${id}-${nextSeq}_${safeName}`;
    const uploadPath = path.join(recordDir, newFileName);

    console.log(`[Uploads] Saving file to: ${uploadPath}`);

    await file.mv(uploadPath);
    try {
        fs.chmodSync(uploadPath, 0o755);
        console.log(`[Uploads] Permissions set for: ${uploadPath}`);
    } catch (e) {
        console.error('[Uploads] Error setting permissions:', e);
    }

    // URL pública: /api/anexos/livros/I-0010/I-0010-1_arquivo.docx
    const publicUrl = `/api/anexos/${subfolder}/${id || 'diversos'}/${newFileName}`;

    console.log(`[Uploads] Upload complete. URL: ${publicUrl}`);

    res.json({
        success: true,
        name: newFileName,
        url: publicUrl
    });
});

module.exports = router;
