const express = require('express');
const router = express.Router();
const SftpClient = require('ssh2-sftp-client');
const path = require('path');
const fileUpload = require('express-fileupload');
router.use(fileUpload({
    useTempFiles: true,
    tempFileDir: '/tmp/',
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
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

const BASE_INTERNAL = process.platform === 'win32'
    ? 'C:\\projeto_poisson_erp'
    : '/home/darly/projeto_poisson_erp';

const BASE_PUBLIC = process.platform === 'win32'
    ? 'C:\\livros.poisson.com.br'
    : '/home/darly/livros.poisson.com.br';

const fs = require('fs').promises;

// Determina subpasta com base no prefixo do ID do registro
function getSubfolder(recordId) {
    if (!recordId) return 'livros';
    if (recordId.startsWith('A-')) return 'artigos';
    return 'livros';
}

// Prefixo de tipo legível para o nome do arquivo
const FILE_TYPE_PREFIX = {
    'cover_front':    'C1',
    'cover_back':     'C2',
    'cover_extra':    'C3',
    'arquivo_artigo': 'artigo',
    'arquivo_cessao': 'cessao',
    'attachment':     'anexo',
};

// Lê credenciais dos headers (perfil do usuário) com fallback para .env
function getSshConfig(req) {
    const config = {
        host: process.env.VPS_SSH_HOST || req.headers['x-ssh-host'] || '127.0.0.1',
        port: parseInt(process.env.VPS_SSH_PORT || req.headers['x-ssh-port'] || '22'),
        username: process.env.VPS_SSH_USER || req.headers['x-ssh-user'],
        password: process.env.VPS_SSH_PASS || req.headers['x-ssh-password'],
        readyTimeout: 30000,
    };
    return config;
}

// Helper: Se o host for local, usa 'fs', senão usa SFTP.
async function withSftp(config, fn) {
    const isLocal = config.host === '127.0.0.1' ||
        config.host === 'localhost' ||
        config.host === process.env.VPS_SSH_HOST ||
        (process.platform === 'linux' && !config.host);

    if (isLocal) {
        console.log(`[Files] Using local file system bypass for ${config.host || 'local'}`);
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
            chmod: async (p, mode) => {
                try { await fs.chmod(p, mode); } catch (e) { }
            },
            delete: async (p) => fs.unlink(p),
            rmdir: async (p, recursive) => fs.rm(p, { recursive, force: true }),
            put: async (source, p) => {
                if (typeof source === 'string') {
                    await fs.copyFile(source, p);
                } else {
                    await fs.writeFile(p, source);
                }
            },
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
    return path.posix.join(BASE_PUBLIC, resolved);
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
    const requestedPath = req.body.path || '';
    const fullPath = safePath(requestedPath);
    try {
        await withSftp(getSshConfig(req), async sftp => {
            await sftp.mkdir(fullPath, true);

            const segments = requestedPath.split('/').filter(Boolean);
            let currentPath = BASE_PUBLIC;
            for (const seg of segments) {
                currentPath = path.posix.join(currentPath, seg);
                try {
                    await sftp.chmod(currentPath, 0o755);
                } catch (e) { }
            }
        });
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

// POST /api/files/upload-record
router.post('/upload-record', async (req, res) => {
    if (!req.files || !req.files.file) return res.status(400).json({ message: 'Nenhum arquivo enviado.' });

    const { recordId, fileIndex, fileType } = req.body;
    const file = req.files.file;
    console.log(`[Files] Upload request: recordId=${recordId}, fileType=${fileType}, fileIndex=${fileIndex}, fileName=${file.name}`);
    if (!recordId) return res.status(400).json({ message: 'recordId é obrigatório.' });

    // Roteamento por prefixo: A- → artigos/, outros → livros/
    const subfolder = getSubfolder(recordId);
    const recordsDir = path.posix.join(BASE_INTERNAL, subfolder, recordId);

    // Prefixo de tipo legível no nome do arquivo
    const normalizedOriginal = normalizeFilename(file.name);
    const prefix = FILE_TYPE_PREFIX[fileType] || (fileIndex ? `f${fileIndex}` : 'arquivo');
    const filename = `${recordId}_${prefix}-${normalizedOriginal}`;

    const destPath = path.posix.join(recordsDir, filename);
    console.log(`[Files] saving to ${destPath}`);

    try {
        await withSftp(getSshConfig(req), async sftp => {
            console.log(`[Files] Using sftp object to mkdir: ${recordsDir}`);
            await sftp.mkdir(recordsDir, true);
            await sftp.chmod(recordsDir, 0o755);
            if (file.tempFilePath) {
                await sftp.put(file.tempFilePath, destPath);
            } else {
                await sftp.put(file.data, destPath);
            }
            await sftp.chmod(destPath, 0o755);
        });

        const publicUrl = `/api/anexos/${subfolder}/${recordId}/${filename}`;
        res.json({ ok: true, name: filename, url: publicUrl });
    } catch (err) {
        console.error(`[Files] Record upload error:`, err.message);
        res.status(500).json({ message: `Erro no upload: ${err.message}` });
    }
});

// POST /api/files/upload  (legado/genérico)
router.post('/upload', async (req, res) => {
    if (!req.files || !req.files.file) return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
    const file = req.files.file;
    const destPath = safePath(path.posix.join(req.body.path || '/', normalizeFilename(file.name)));
    try {
        await withSftp(getSshConfig(req), async sftp => {
            if (file.tempFilePath) {
                await sftp.put(file.tempFilePath, destPath);
            } else {
                await sftp.put(file.data, destPath);
            }
            await sftp.chmod(destPath, 0o755);
        });
        res.json({ ok: true, name: file.name });
    } catch (err) {
        res.status(500).json({ message: `Erro no upload: ${err.message}` });
    }
});

// GET /api/files/content?path=/arquivo.jpg
router.get('/content', async (req, res) => {
    const fullPath = safePath(req.query.path);
    try {
        let buffer;
        await withSftp(getSshConfig(req), async sftp => {
            const chunks = [];
            const stream = new (require('stream').PassThrough)();
            const promise = new Promise((resolve, reject) => {
                stream.on('data', chunk => chunks.push(chunk));
                stream.on('end', () => resolve(Buffer.concat(chunks)));
                stream.on('error', reject);
            });
            await sftp.get(fullPath, stream);
            buffer = await promise;
        });

        const ext = path.extname(fullPath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        res.json({ ok: true, content: buffer.toString('base64'), mime });
    } catch (err) {
        res.status(500).json({ message: `Erro ao ler conteúdo: ${err.message}` });
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
