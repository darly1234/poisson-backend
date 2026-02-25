const express = require('express');
const router = express.Router();
const SftpClient = require('ssh2-sftp-client');
const path = require('path');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const BASE = process.env.VPS_FILES_BASE || '/home/darly/livros.poisson.com.br';

// Lê credenciais dos headers (perfil do usuário) com fallback para .env
function getSshConfig(req) {
    return {
        host: req.headers['x-ssh-host'] || process.env.VPS_SSH_HOST,
        port: parseInt(process.env.VPS_SSH_PORT || '22'),
        username: req.headers['x-ssh-user'] || process.env.VPS_SSH_USER,
        password: req.headers['x-ssh-password'] || process.env.VPS_SSH_PASSWORD,
        readyTimeout: 10000,
    };
}

// Helper: conecta SFTP, executa fn(sftp), desconecta
async function withSftp(config, fn) {
    const sftp = new SftpClient();
    await sftp.connect(config);
    try {
        return await fn(sftp);
    } finally {
        await sftp.end().catch(() => { });
    }
}

// Sanitiza path evitando path traversal
function safePath(requestedPath) {
    const resolved = path.posix.resolve('/', requestedPath || '/');
    return path.posix.join(BASE, resolved);
}

// GET /api/files/list?path=/subpasta
router.get('/list', async (req, res) => {
    const fullPath = safePath(req.query.path);
    try {
        const list = await withSftp(getSshConfig(req), sftp => sftp.list(fullPath));
        const items = list.map(f => ({
            name: f.name,
            type: f.type === 'd' ? 'dir' : 'file',
            size: f.size,
            modTime: f.modifyTime,
        })).sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        res.json({ ok: true, path: req.query.path || '/', items });
    } catch (err) {
        res.status(500).json({ message: `Erro ao listar: ${err.message}` });
    }
});

// POST /api/files/mkdir  { path }
router.post('/mkdir', async (req, res) => {
    const fullPath = safePath(req.body.path);
    try {
        await withSftp(getSshConfig(req), sftp => sftp.mkdir(fullPath, true));
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: `Erro ao criar pasta: ${err.message}` });
    }
});

// DELETE /api/files/delete  { path, type }
router.delete('/delete', async (req, res) => {
    const fullPath = safePath(req.body.path);
    const type = req.body.type;
    try {
        await withSftp(getSshConfig(req), sftp => type === 'dir' ? sftp.rmdir(fullPath, true) : sftp.delete(fullPath));
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: `Erro ao apagar: ${err.message}` });
    }
});

// POST /api/files/upload  (multipart: path, file)
router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
    const destPath = safePath(path.posix.join(req.body.path || '/', req.file.originalname));
    try {
        await withSftp(getSshConfig(req), sftp => sftp.put(req.file.buffer, destPath));
        res.json({ ok: true, name: req.file.originalname });
    } catch (err) {
        res.status(500).json({ message: `Erro no upload: ${err.message}` });
    }
});

// GET /api/files/download?path=/arquivo.pdf
router.get('/download', async (req, res) => {
    const fullPath = safePath(req.query.path);
    const filename = path.posix.basename(fullPath);
    try {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await withSftp(getSshConfig(req), sftp => sftp.get(fullPath, res));
    } catch (err) {
        res.status(500).json({ message: `Erro no download: ${err.message}` });
    }
});

module.exports = router;
