const { Client } = require('pg');
const pool = new Client({
  host: 'localhost',
  port: 5432,
  database: 'poisson_erp',
  user: 'postgres',
  password: 'ylrad320@',
});

const URL_BASE_INDIVIDUAIS = 'https://livros.poisson.com.br/individuais/';
const URL_BASE_COLETANEA = 'https://livros.poisson.com.br/';

async function run() {
  await pool.connect();
  console.log('Connected to DB. Starting migration...');

  const res = await pool.query("SELECT id, data FROM records WHERE id LIKE 'I-%' OR id LIKE 'ID-%' OR id LIKE 'C-%'");
  console.log(`Found ${res.rows.length} records to check.`);

  let updatedCount = 0;

  for (const row of res.rows) {
    const id = row.id;
    const data = row.data || {};
    const oldUrl = data.url || '';
    
    // Determine target base
    const isIndividual = id.startsWith('I-') || id.startsWith('ID-');
    const targetBase = isIndividual ? URL_BASE_INDIVIDUAIS : URL_BASE_COLETANEA;
    
    let suffix = '';
    
    // Extract existing suffix if it already has a base
    if (oldUrl.startsWith(URL_BASE_INDIVIDUAIS)) {
        suffix = oldUrl.slice(URL_BASE_INDIVIDUAIS.length);
    } else if (oldUrl.startsWith(URL_BASE_COLETANEA)) {
        suffix = oldUrl.slice(URL_BASE_COLETANEA.length);
    } else if (oldUrl.startsWith('http')) {
        try {
            const urlObj = new URL(oldUrl);
            const path = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname;
            if (path.startsWith('individuais/')) {
                suffix = path.slice(12);
            } else {
                suffix = path;
            }
        } catch (e) { suffix = oldUrl; }
    } else {
        suffix = oldUrl;
    }

    const newUrl = targetBase + suffix;

    if (newUrl !== oldUrl) {
      data.url = newUrl;
      await pool.query('UPDATE records SET data = $1 WHERE id = $2', [JSON.stringify(data), id]);
      updatedCount++;
      if (id === 'I-0009') {
          console.log(`Special check I-0009: Updated from [${oldUrl}] to [${newUrl}]`);
      }
    }
  }

  console.log(`Migration finished. Updated ${updatedCount} records.`);
  await pool.end();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
