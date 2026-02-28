const express = require('express');
const router = express.Router();
const SftpClient = require('ssh2-sftp-client');
const path = require('path');
const fileUpload = require('express-fileupload');
router.use(fileUpload());

function normalizeFilename(name) {
    if (!name) return '';
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ç/g, 'c')
        .replace(/Ç/g, 'C')
        .replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

const BASE = process.env.VPS_FILES_BASE || '/home/darly/livros.poisson.com.br';

const fs = require('fs').promises;

// Lê credenciais dos headers (perfil do usuário) com fallback para .env
function getSshConfig(req) {
    const config = {
        host: process.env.VPS_SSH_HOST || req.headers['x-ssh-host'] || '127.0.0.1',
        port: parseInt(process.env.VPS_SSH_PORT || req.headers['x-ssh-port'] || '22'),
        username: process.env.VPS_SSH_USER || req.headers['x-ssh-user'],
        password: process.env.VPS_SSH_PASSWORD || req.headers['x-ssh-password'],
        readyTimeout: 10000,
    };
    return config;
}

// Helper: Se o host for local, usa 'fs', senão usa SFTP.
async function withSftp(config, fn) {
    const isLocal = config.host === '127.0.0.1' || config.host === 'localhost';

    if (isLocal) {
        console.log(`[Files] Using local file system for ${config.host}`);
        // Criamos um mock do objeto sftp que usa fs
        const localFs = {
            list: async (p) => {
                const files = await fs.readdir(p, { withFileTypes: true });
                return files.map(f => ({
                    name: f.name,
                    type: f.isDirectory() ? 'd' : '-',
                    size: 0,
                    modifyTime: Date.now()
                }));
            },
            mkdir: async (p, recursive) => fs.mkdir(p, { recursive }),
            delete: async (p) => fs.unlink(p),
            rmdir: async (p, recursive) => fs.rm(p, { recursive, force: true }),
            put: async (buffer, p) => fs.writeFile(p, buffer),
            get: async (p, stream) => {
                const data = await fs.readFile(p);
                stream.write(data);
                stream.end();
            }
        };
        return await fn(localFs);
    }

    console.log(`[SSH Debug] Connecting to ${config.host}:${config.port} as ${config.username}`);
    const sftp = new SftpClient();
    try {
        await sftp.connect(config);
        console.log(`[SSH Debug] Connected successfully to ${config.host}`);
        return await fn(sftp);
    } catch (err) {
        console.error(`[SSH Error] Failed to connect/execute on ${config.host}:`, err.message);
        throw err;
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
router.post('/upload', async (req, res) => {
    if (!req.files || !req.files.file) return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
    const file = req.files.file;
    const destPath = safePath(path.posix.join(req.body.path || '/', normalizeFilename(file.name)));
    console.log(`[Files] Uploading ${file.name} to ${destPath}`);
    try {
        await withSftp(getSshConfig(req), sftp => sftp.put(file.data, destPath));
        console.log(`[Files] Upload success: ${destPath}`);
        res.json({ ok: true, name: file.name });
    } catch (err) {
        console.error(`[Files] Upload error:`, err.message);
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
