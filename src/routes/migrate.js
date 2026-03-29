const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const BASE = '/home/darly/projeto_poisson_erp';
const OLD_ANEXOS = '/var/www/anexos_individuais';
const NEW_LIVROS = path.join(BASE, 'livros');
const NEW_ATIVOS = path.join(BASE, 'diversos/ativos');
const NEW_BACKUP = path.join(BASE, 'backup');
const NEW_EXPORTS = path.join(BASE, 'exports');

function move(oldPath, newPath, logs) {
    if (!fs.existsSync(oldPath)) return;
    const parentDir = path.dirname(newPath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    try {
        fs.renameSync(oldPath, newPath);
        logs.push(`[OK] Migrated: ${oldPath} -> ${newPath}`);
    } catch (e) {
        logs.push(`[ERR] Failed ${oldPath}: ${e.message}`);
    }
}

router.get('/run', (req, res) => {
    const logs = [];
    try {
        [NEW_LIVROS, NEW_ATIVOS, NEW_BACKUP, NEW_EXPORTS].forEach(p => {
            if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
        });

        if (fs.existsSync(OLD_ANEXOS)) {
            fs.readdirSync(OLD_ANEXOS).forEach(file => move(path.join(OLD_ANEXOS, file), path.join(NEW_ATIVOS, file), logs));
        }

        if (fs.existsSync(BASE)) {
            fs.readdirSync(BASE).forEach(item => {
                const fullPath = path.join(BASE, item);
                if (fs.lstatSync(fullPath).isDirectory() && /^\d+$/.test(item)) {
                    move(fullPath, path.join(NEW_LIVROS, `I-${item}`), logs);
                }
            });
        }
        res.json({ success: true, logs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, logs });
    }
});

module.exports = router;
