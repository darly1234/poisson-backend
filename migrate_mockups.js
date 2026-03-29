const pool = require('./src/db');
const fs = require('fs');
const path = require('path');

const BASE_INTERNAL = process.platform === 'win32' 
    ? 'C:\\projeto_poisson_erp' 
    : '/home/darly/projeto_poisson_erp';
const MOCKUPS_PATH = path.join(BASE_INTERNAL, 'mockups');

if (!fs.existsSync(MOCKUPS_PATH)) {
    console.log('Creating mockups directory...');
    fs.mkdirSync(MOCKUPS_PATH, { recursive: true });
}

async function migrateKey(key) {
    console.log(`Checking key: ${key}...`);
    const res = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
    if (res.rows.length === 0) return false;

    let data = res.rows[0].value;
    if (!Array.isArray(data)) {
        if (typeof data === 'object' && data !== null) {
            data = [data]; // Caso legado de objeto único
        } else {
            return false;
        }
    }

    let changed = false;

    const processItem = (item) => {
        // Background
        if (item.background && typeof item.background.image === 'string' && item.background.image.startsWith('data:image')) {
            const ext = item.background.image.split(';')[0].split('/')[1] || 'png';
            const fileName = `bg-${item.id || Date.now()}-${Math.random().toString(36).substr(2, 5)}.${ext}`;
            const base64Data = item.background.image.split(',')[1];
            fs.writeFileSync(path.join(MOCKUPS_PATH, fileName), base64Data, 'base64');
            item.background.image = `/api/anexos/mockups/${fileName}`;
            changed = true;
        }

        // Elements
        if (Array.isArray(item.elements)) {
            item.elements.forEach(el => {
                if (typeof el.src === 'string' && el.src.startsWith('data:image')) {
                    const ext = el.src.split(';')[0].split('/')[1] || 'png';
                    const fileName = `el-${el.id || Date.now()}-${Math.random().toString(36).substr(2, 5)}.${ext}`;
                    const base64Data = el.src.split(',')[1];
                    fs.writeFileSync(path.join(MOCKUPS_PATH, fileName), base64Data, 'base64');
                    el.src = `/api/anexos/mockups/${fileName}`;
                    changed = true;
                }
            });
        }

        // Library items (se for a chave mockup_library)
        if (typeof item.src === 'string' && item.src.startsWith('data:image')) {
            const ext = item.src.split(';')[0].split('/')[1] || 'png';
            const fileName = `lib-${item.id || Date.now()}-${Math.random().toString(36).substr(2, 5)}.${ext}`;
            const base64Data = item.src.split(',')[1];
            fs.writeFileSync(path.join(MOCKUPS_PATH, fileName), base64Data, 'base64');
            item.src = `/api/anexos/mockups/${fileName}`;
            changed = true;
        }
    };

    data.forEach(processItem);

    if (changed) {
        await pool.query("UPDATE settings SET value = $1 WHERE key = $2", [JSON.stringify(data), key]);
        console.log(`✓ Key ${key} migrated successfully.`);
        return true;
    }
    console.log(`- No base64 found in ${key}.`);
    return false;
}

async function run() {
    try {
        await migrateKey('mockup_templates');
        await migrateKey('mockup_library');
        console.log('Migration process finished.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

run();
