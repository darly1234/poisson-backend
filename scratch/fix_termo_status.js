const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'poisson_erp', user: 'postgres', password: 'ylrad320@',
});

async function updateTerms() {
  try {
    console.log('Iniciando atualização de Status do Termo para publicados...');
    
    // Busca registros publicados que têm arquivo de cessão mas o status do termo não é Completo
    const { rows } = await pool.query(`
      SELECT id, data FROM records 
      WHERE data->>'status_publicacao' = 'Publicado'
      AND data->>'arquivo_cessao' IS NOT NULL
      AND (data->'avaliacao_dados'->>'status_termo' != 'Completo' OR data->'avaliacao_dados'->>'status_termo' IS NULL)
    `);
    
    console.log(`Encontrados ${rows.length} registros para atualizar.`);
    
    let updatedCount = 0;
    for (const row of rows) {
      const newData = { ...row.data };
      if (!newData.avaliacao_dados) newData.avaliacao_dados = {};
      newData.avaliacao_dados.status_termo = 'Completo';
      
      await pool.query('UPDATE records SET data = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(newData), row.id]);
      updatedCount++;
    }
    
    console.log(`Atualização concluída: ${updatedCount} registros marcados como Completo.`);
  } catch (err) {
    console.error('Erro na atualização:', err);
  } finally {
    await pool.end();
  }
}

updateTerms();
