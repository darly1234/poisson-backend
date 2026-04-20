const fs = require('fs');
const path = require('path');

const BASE = '/home/darly/projeto_poisson_erp';
const OLD_ANEXOS = '/var/www/anexos_individuais';
const NEW_LIVROS = path.join(BASE, 'livros');
const NEW_ATIVOS = path.join(BASE, 'diversos/ativos');
const NEW_BACKUP = path.join(BASE, 'backup');
const NEW_EXPORTS = path.join(BASE, 'exports');

// Função auxiliar para mover arquivos/pastas
function move(oldPath, newPath) {
    if (!fs.existsSync(oldPath)) return;

    const parentDir = path.dirname(newPath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
        fs.chmodSync(parentDir, 0o755);
    }

    try {
        fs.renameSync(oldPath, newPath);
        console.log(`[Migrated] ${oldPath} -> ${newPath}`);
    } catch (e) {
        if (e.code === 'EXDEV') {
            // Se for entre sistemas de arquivos diferentes, copia e deleta
            copyRecursiveSync(oldPath, newPath);
            deleteRecursiveSync(oldPath);
            console.log(`[Migrated (Copy)] ${oldPath} -> ${newPath}`);
        } else {
            console.error(`[Error] Failed to move ${oldPath}: ${e.message}`);
        }
    }
}

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = stats && stats.isDirectory();
    if (isDirectory) {
        fs.mkdirSync(dest, { recursive: true });
        fs.chmodSync(dest, 0o755);
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 0o755);
    }
}

function deleteRecursiveSync(root) {
    if (fs.existsSync(root)) {
        fs.readdirSync(root).forEach((file) => {
            const curPath = path.join(root, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteRecursiveSync(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(root);
    }
}

console.log('--- Iniciando Migração de Arquivos ---');

// 1. Criar pastas base se não existirem
[NEW_LIVROS, NEW_ATIVOS, NEW_BACKUP, NEW_EXPORTS].forEach(p => {
    if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
        fs.chmodSync(p, 0o755);
    }
});

// 2. Mover ativos de /var/www/anexos_individuais para diversos/ativos
if (fs.existsSync(OLD_ANEXOS)) {
    fs.readdirSync(OLD_ANEXOS).forEach(file => {
        move(path.join(OLD_ANEXOS, file), path.join(NEW_ATIVOS, file));
    });
}

// 3. Mover pastas de livros (numéricas) para livros/I-XXXX
if (fs.existsSync(BASE)) {
    fs.readdirSync(BASE).forEach(item => {
        const fullPath = path.join(BASE, item);
        // Se for uma pasta puramente numérica (ex: 0001)
        if (fs.statSync(fullPath).isDirectory() && /^\d+$/.test(item)) {
            const idCompleto = `I-${item}`;
            move(fullPath, path.join(NEW_LIVROS, idCompleto));
        }
    });
}

// 4. Mover backups e exports da raiz do backend (se existirem nos locais antigos)
const BACKEND_ROOT = path.join(__dirname, '..');
const OLD_BACKUP = path.join(BACKEND_ROOT, 'backups');
const OLD_EXPORT = path.join(BACKEND_ROOT, 'exports');

if (fs.existsSync(OLD_BACKUP)) {
    fs.readdirSync(OLD_BACKUP).forEach(file => {
        move(path.join(OLD_BACKUP, file), path.join(NEW_BACKUP, file));
    });
}

if (fs.existsSync(OLD_EXPORT)) {
    fs.readdirSync(OLD_EXPORT).forEach(file => {
        move(path.join(OLD_EXPORT, file), path.join(NEW_EXPORTS, file));
    });
}

console.log('--- Migração Concluída ---');
