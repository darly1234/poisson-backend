
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS });

const updates = [
  { id: 'A-0543', isbn: '978-65-5866-631-8', cap: 8, doi: '10.36229/978-65-5866-631-8.CAP.08', book: 'Ciências da Saúde em Foco – Volume 12' },
  { id: 'A-0578', isbn: '978-65-5866-656-1', cap: 2, doi: '10.36229/978-65-5866-656-1.CAP.02', book: 'Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11' },
  { id: 'A-0589', isbn: '978-65-5866-656-1', cap: 6, doi: '10.36229/978-65-5866-656-1.CAP.06', book: 'Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11' },
  { id: 'A-0533', isbn: '978-65-5866-642-4', cap: 5, doi: '10.36229/978-65-5866-642-4.CAP.05', book: 'Ciências Rurais no Século XXI – Volume 9' },
  { id: 'A-0609', isbn: '978-65-5866-657-8', cap: 1, doi: '10.36229/978-65-5866-657-8.CAP.01', book: 'Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados' },
  { id: 'A-0565', isbn: '978-65-5866-657-8', cap: 2, doi: '10.36229/978-65-5866-657-8.CAP.02', book: 'Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados' },
  { id: 'A-0612', isbn: '978-65-5866-657-8', cap: 5, doi: '10.36229/978-65-5866-657-8.CAP.05', book: 'Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados' },
  { id: 'A-0529', isbn: '978-65-5866-657-8', cap: 6, doi: '10.36229/978-65-5866-657-8.CAP.06', book: 'Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados' },
  { id: 'A-0580', isbn: '978-65-5866-657-8', cap: 9, doi: '10.36229/978-65-5866-657-8.CAP.09', book: 'Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados' }
];

async function run() {
  for (const update of updates) {
    const { rows } = await pool.query("SELECT data FROM records WHERE id = $1", [update.id]);
    if (rows.length === 1) {
      const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
      data.status_publicacao = "Publicado";
      data.data_publicacao = "17/04/2026";
      data.isbn = update.isbn;
      data.doi = update.doi;
      data.capitulo = update.cap;
      data.livro_escolhido = update.book;
      await pool.query('UPDATE records SET data = $1 WHERE id = $2', [JSON.stringify(data), update.id]);
      console.log('Updated ' + update.id);
    }
  }
  process.exit(0);
}
run();
