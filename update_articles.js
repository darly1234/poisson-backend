const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

const updates = [
  // Book 1
  { search: "PROPRIEDADES FÍSICAS DO GRÃO DE MILHO EM CONDIÇÃO DE PRODUÇÃO DE MALT", isbn: "978-65-5866-606-6", cap: 1, doi: "10.36229/978-65-5866-606-6.CAP.01", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "Determinação experimental das propriedades físicas do grão de milho em condiçõe", isbn: "978-65-5866-606-6", cap: 2, doi: "10.36229/978-65-5866-606-6.CAP.02", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "Composição química de leites bubalinos, bovinos, caprinos e ovinos", isbn: "978-65-5866-606-6", cap: 3, doi: "10.36229/978-65-5866-606-6.CAP.03", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "Comportamento reológico do leite de búfala: influência da temperatura e da conce", isbn: "978-65-5866-606-6", cap: 4, doi: "10.36229/978-65-5866-606-6.CAP.04", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "Estudo de pós-acidificação refrigerada em iogurte com leite tipo A2", isbn: "978-65-5866-606-6", cap: 5, doi: "10.36229/978-65-5866-606-6.CAP.05", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "Aproveitamento de casca de melão pele de sapo", isbn: "978-65-5866-606-6", cap: 6, doi: "10.36229/978-65-5866-606-6.CAP.06", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "EFEITO DE MÉTODOS DE SECAGEM NOS COMPOSTOS BIOATIVOS E CARACTERÍSTICA", isbn: "978-65-5866-606-6", cap: 7, doi: "10.36229/978-65-5866-606-6.CAP.07", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "Uso do mel em processos fermentativos com matérias-primas nativas: avanços e pe", isbn: "978-65-5866-606-6", cap: 8, doi: "10.36229/978-65-5866-606-6.CAP.08", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "Indicações geográficas e valorização da identidade regional dos queijos artesanais", isbn: "978-65-5866-606-6", cap: 9, doi: "10.36229/978-65-5866-606-6.CAP.09", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "Auditoria de qualidade e segurança de alimentos em redes de fast food: relato de", isbn: "978-65-5866-606-6", cap: 10, doi: "10.36229/978-65-5866-606-6.CAP.10", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "Impacto sanitário do controle de qualidade no processo de fabricação do gelo: uma", isbn: "978-65-5866-606-6", cap: 11, doi: "10.36229/978-65-5866-606-6.CAP.11", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },
  { search: "Estudo da qualidade da água de chafarizes moedeiros comercializada no município", isbn: "978-65-5866-606-6", cap: 12, doi: "10.36229/978-65-5866-606-6.CAP.12", book: "Ciência dos Alimentos: Pesquisa e Aplicações – Volume 9" },

  // Book 2
  { search: "Saúde mental materna e repercussões gestacionais: uma análise psicológica sobre", isbn: "978-65-5866-631-8", cap: 1, doi: "10.36229/978-65-5866-631-8.CAP.01", book: "Ciências da Saúde em Foco – Volume 12" },
  { search: "AVALIAÇÃO EFETIVA DE INFECÇÕES DE ENFERMAGEM NO CUIDADO DO RECÉM-NASC", isbn: "978-65-5866-631-8", cap: 2, doi: "10.36229/978-65-5866-631-8.CAP.02", book: "Ciências da Saúde em Foco – Volume 12" },
  { search: "Análise dos fatores associados à icterícia neonatal e manejo clínico: relato de caso", isbn: "978-65-5866-631-8", cap: 3, doi: "10.36229/978-65-5866-631-8.CAP.03", book: "Ciências da Saúde em Foco – Volume 12" },
  { search: "Perfil epidemiológico da tuberculose em pessoas idosas: desafios no contexto do c", isbn: "978-65-5866-631-8", cap: 4, doi: "10.36229/978-65-5866-631-8.CAP.04", book: "Ciências da Saúde em Foco – Volume 12" },
  { search: "ESPOROTRICOSE HUMANA: ANÁLISE DO PAPEL DO ENFERMEIRO NA VIGILÂNCIA E N", isbn: "978-65-5866-631-8", cap: 5, doi: "10.36229/978-65-5866-631-8.CAP.05", book: "Ciências da Saúde em Foco – Volume 12" },
  { search: "Entre o marco legal e o adoecimento: gênero, trabalho de cuidado e saúde das trab", isbn: "978-65-5866-631-8", cap: 6, doi: "10.36229/978-65-5866-631-8.CAP.06", book: "Ciências da Saúde em Foco – Volume 12" },
  { search: "Oficinas terapêuticas em saúde mental: entre cuidado e transformação social", isbn: "978-65-5866-631-8", cap: 7, doi: "10.36229/978-65-5866-631-8.CAP.07", book: "Ciências da Saúde em Foco – Volume 12" },
  { search: "Construção e registro de tecnologia em saúde para implantação de Práticas Integral", isbn: "978-65-5866-631-8", cap: 8, doi: "10.36229/978-65-5866-631-8.CAP.08", book: "Ciências da Saúde em Foco – Volume 12" },

  // Book 3
  { search: "O território como expressão das contradições sociais e do trabalho no campo", isbn: "978-65-5866-656-1", cap: 1, doi: "10.36229/978-65-5866-656-1.CAP.01", book: "Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11" },
  { search: "Entre modernidade e moralidade: o silêncio sobre a história das mulheres nos ever", isbn: "978-65-5866-656-1", cap: 2, doi: "10.36229/978-65-5866-656-1.CAP.02", book: "Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11" },
  { search: "Moda e patrimônio: estudo e preservação de vestimentas e acessórios dos séculos", isbn: "978-65-5866-656-1", cap: 3, doi: "10.36229/978-65-5866-656-1.CAP.03", book: "Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11" },
  { search: "A APOSENTADORIA DO SERVIDOR PÚBLICO COMO LUTO INSTITUCIONAL: IDENTIDAD", isbn: "978-65-5866-656-1", cap: 4, doi: "10.36229/978-65-5866-656-1.CAP.04", book: "Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11" },
  { search: "IMPACTO DA ROTINA ACADÊMICA NA ALIMENTAÇÃO, SONO E ATIVIDADE FÍSICA EN", isbn: "978-65-5866-656-1", cap: 5, doi: "10.36229/978-65-5866-656-1.CAP.05", book: "Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11" },
  { search: "Uma visão sociológica critica sobre o atendimento médico", isbn: "978-65-5866-656-1", cap: 6, doi: "10.36229/978-65-5866-656-1.CAP.06", book: "Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11" },
  { search: "Da vulnerabilidade à afirmação: um percurso teórico-empírico sobre habilidades so", isbn: "978-65-5866-656-1", cap: 7, doi: "10.36229/978-65-5866-656-1.CAP.07", book: "Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11" },
  { search: "Integração entre terapia cognitivo-comportamental e treinamento de habilidades s", isbn: "978-65-5866-656-1", cap: 8, doi: "10.36229/978-65-5866-656-1.CAP.08", book: "Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11" },
  { search: "O manejo da suicidalidade no campo da saúde mental: contribuições da terapia cog", isbn: "978-65-5866-656-1", cap: 9, doi: "10.36229/978-65-5866-656-1.CAP.09", book: "Ciências Humanas e Sociais: Perspectivas Interdisciplinares - Volume 11" },

  // Book 4
  { search: "Agricultura de baixo carbono", isbn: "978-65-5866-642-4", cap: 1, doi: "10.36229/978-65-5866-642-4.CAP.01", book: "Ciências Rurais no Século XXI – Volume 9" },
  { search: "Potássio na agricultura", isbn: "978-65-5866-642-4", cap: 2, doi: "10.36229/978-65-5866-642-4.CAP.02", book: "Ciências Rurais no Século XXI – Volume 9" },
  { search: "Aplicação de modelos mistos (REML/BLUP) na seleção de genótipos de arroz irrigad", isbn: "978-65-5866-642-4", cap: 3, doi: "10.36229/978-65-5866-642-4.CAP.03", book: "Ciências Rurais no Século XXI – Volume 9" },
  { search: "Seleção de genótipos de arroz irrigado em Campos dos Goytacazes via análise de m", isbn: "978-65-5866-642-4", cap: 4, doi: "10.36229/978-65-5866-642-4.CAP.04", book: "Ciências Rurais no Século XXI – Volume 9" },
  { search: "Fontes orgânicas de nitrogênio e borra de café na produção de biocompósitos color", isbn: "978-65-5866-642-4", cap: 5, doi: "10.36229/978-65-5866-642-4.CAP.05", book: "Ciências Rurais no Século XXI – Volume 9" },
  { search: "Caracterização do crescimento ponderal de frangos caipiras Gris Cendré em ambien", isbn: "978-65-5866-642-4", cap: 6, doi: "10.36229/978-65-5866-642-4.CAP.06", book: "Ciências Rurais no Século XXI – Volume 9" },
  { search: "Gestão da qualidade no abate avícola: processos, normas e boas práticas", isbn: "978-65-5866-642-4", cap: 7, doi: "10.36229/978-65-5866-642-4.CAP.07", book: "Ciências Rurais no Século XXI – Volume 9" },
  { search: "Da zootecnia à medicina: miniporcos e suas contribuições para a pesquisa médica tr", isbn: "978-65-5866-642-4", cap: 8, doi: "10.36229/978-65-5866-642-4.CAP.08", book: "Ciências Rurais no Século XXI – Volume 9" },
  { search: "Correlação entre déficit de grelina, leptina e aumento de lipase pancreática em cãe", isbn: "978-65-5866-642-4", cap: 9, doi: "10.36229/978-65-5866-642-4.CAP.09", book: "Ciências Rurais no Século XXI – Volume 9" },
  { search: "Legislação aplicada aos produtos de abelhas sem ferrão, com ênfase na inspeção de", isbn: "978-65-5866-642-4", cap: 10, doi: "10.36229/978-65-5866-642-4.CAP.10", book: "Ciências Rurais no Século XXI – Volume 9" },

  // Book 5
  { search: "Mudanças climáticas e desastres naturais: Avaliação da gestão de resíduos sólidos d", isbn: "978-65-5866-657-8", cap: 1, doi: "10.36229/978-65-5866-657-8.CAP.01", book: "Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados" },
  { search: "Inundações: qualidade dos recursos hídricos e efeitos na saúde humana", isbn: "978-65-5866-657-8", cap: 2, doi: "10.36229/978-65-5866-657-8.CAP.02", book: "Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados" },
  { search: "Áreas protegidas na Zona Costeira brasileira: reflexões sobre a efetividade da Área", isbn: "978-65-5866-657-8", cap: 3, doi: "10.36229/978-65-5866-657-8.CAP.03", book: "Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados" },
  { search: "Caracterização físico-química de macrófitas (Eichhornia crassipes)", isbn: "978-65-5866-657-8", cap: 4, doi: "10.36229/978-65-5866-657-8.CAP.04", book: "Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados" },
  { search: "Caracterização físico-química do endocarpo do buriti (Mauritia flexuosa)", isbn: "978-65-5866-657-8", cap: 5, doi: "10.36229/978-65-5866-657-8.CAP.05", book: "Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados" },
  { search: "Pó de coco e tapioca na fabricação de biocompósito colonizado pelo cogumelo 'shii", isbn: "978-65-5866-657-8", cap: 6, doi: "10.36229/978-65-5866-657-8.CAP.06", book: "Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados" },
  { search: "Fontes nitrogenadas inorgânicas no crescimento micelial do cogumelo 'Shiitake' e n", isbn: "978-65-5866-657-8", cap: 7, doi: "10.36229/978-65-5866-657-8.CAP.07", book: "Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados" },
  { search: "Proposição de estratégia environmental, social and governance (ESG) para uma con", isbn: "978-65-5866-657-8", cap: 8, doi: "10.36229/978-65-5866-657-8.CAP.08", book: "Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados" },
  { search: "Ensino de quimica e crise climática: como formar estudantes para um mundo em em", isbn: "978-65-5866-657-8", cap: 9, doi: "10.36229/978-65-5866-657-8.CAP.09", book: "Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados" },
  { search: "Meio ambiente com fibra no parque do Utinga: prática pedagógica interdisciplinar e", isbn: "978-65-5866-657-8", cap: 10, doi: "10.36229/978-65-5866-657-8.CAP.10", book: "Sustentabilidade, Meio Ambiente e Responsabilidade Social - Artigos Selecionados" },
];

async function run() {
  const { rows } = await pool.query("SELECT * FROM records WHERE id LIKE 'A-%'");
  let updatedCount = 0;

  for (let update of updates) {
    // Find the record by fuzzy title matching
    const searchStr = update.search.toLowerCase().trim();
    const matched = rows.filter(r => {
      const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      const title = (data.titulo_do_documento || data.titulo_artigo || data.titulo || '').toLowerCase().trim();
      return title.startsWith(searchStr) || title.includes(searchStr);
    });

    if (matched.length === 1) {
      const rec = matched[0];
      const data = typeof rec.data === 'string' ? JSON.parse(rec.data) : rec.data;
      data.status_publicacao = "Publicado";
      data.data_publicacao = "17/04/2026";
      data.isbn = update.isbn;
      data.doi = update.doi;
      data.capitulo = update.cap;
      data.livro_escolhido = update.book;

      await pool.query('UPDATE records SET data = $1 WHERE id = $2', [JSON.stringify(data), rec.id]);
      updatedCount++;
      console.log(`Updated ${rec.id}: ${update.search}`);
    } else {
      console.log(`Failed to match strictly 1 record for: ${update.search} - Matched: ${matched.length}`);
      if (matched.length > 1) {
          console.log(matched.map(m => m.id).join(', '));
      }
    }
  }

  console.log(`Total updated: ${updatedCount} / ${updates.length}`);
  process.exit(0);
}

run();
