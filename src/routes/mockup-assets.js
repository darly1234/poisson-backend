const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fileUpload = require('express-fileupload');

const BASE_INTERNAL = process.platform === 'win32'
    ? 'C:\\projeto_poisson_erp'
    : '/home/darly/projeto_poisson_erp';

const MOCKUPS_PATH = path.join(BASE_INTERNAL, 'mockups');

// Garante que a pasta existe
try {
    if (!fs.existsSync(MOCKUPS_PATH)) {
        fs.mkdirSync(MOCKUPS_PATH, { recursive: true });
    }
} catch (e) {
    console.error('Error creating mockups directory:', e);
}

router.use(fileUpload({
    useTempFiles: true,
    tempFileDir: '/tmp/',
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
}));

function normalizeFilename(name) {
    if (!name) return '';
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ç/g, 'c')
        .replace(/Ç/g, 'C')
        .replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

const sharp = require('sharp');

// POST /api/mockups/upload-asset
router.post('/upload-asset', async (req, res) => {
    if (!req.files || !req.files.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const file = req.files.file;
    const timestamp = Date.now();
    const safeName = normalizeFilename(file.originalName || file.name).replace(/\.[^/.]+$/, ""); // Remove extension
    const fileName = `asset-${timestamp}-${safeName}.webp`;
    const uploadPath = path.join(MOCKUPS_PATH, fileName);

    try {
        // Compress using sharp to WebP
        await sharp(file.tempFilePath)
            .webp({ quality: 80, effort: 6 })
            .toFile(uploadPath);

        // Remove temp file
        if (fs.existsSync(file.tempFilePath)) {
            fs.unlinkSync(file.tempFilePath);
        }

        fs.chmodSync(uploadPath, 0o755);

        res.json({
            success: true,
            url: `/api/anexos/mockups/${fileName}`,
            name: fileName
        });
    } catch (err) {
        console.error('Error compressing/uploading mockup asset:', err);
        res.status(500).json({ error: 'Erro ao processar e salvar arquivo na VPS' });
    }
});

module.exports = router;
