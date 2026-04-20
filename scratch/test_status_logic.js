const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'poisson_erp', user: 'postgres', password: 'ylrad320@',
});

const getArtigoFlowStatus = (r) => {
    const d = r.data || {};
    const e = d.avaliacao_dados || {};
    const statusTermo = e.status_termo || 'Não enviado';
    const statusPagamento = e.status_pagamento || 'Aguardando';
    const statusAvaliacao = e.status_avaliacao || 'Pendente';
    const statusPublicacao = d.status_publicacao || '';
    const livroEscolhido = d.livro_escolhido || '';

    if (statusPublicacao === 'Desistência') return 'Desistentes';
    
    // Filtro especial para Livros (TCC, Teses, etc)
    if (livroEscolhido === 'TCC, Monografia, Dissertação, Tese, Livro Completo') return 'Livros';

    // Check for any type of article upload
    const hasUpload = !!(d.arquivo_artigo || d.arquivo_editado || d.arquivo_dissertacao || d.arquivo_tese || d.arquivo_monografia || d.arquivo_tcc || d.arquivo_original);

    if (statusAvaliacao === 'Reprovado' && hasUpload) return 'Reprovados';
    
    // Publicados
    if (statusPublicacao === 'Publicado') {
        return statusTermo === 'Completo' ? 'Publicado Finalizado' : 'Publicado sem Termo';
    }
    
    // Aprovados
    if (statusAvaliacao === 'Aprovado') {
        if (statusPagamento === 'Aguardando' || statusPagamento === 'Cancelado') return 'Aguardando Pagamento';
        // 'Pendente' agora também é tratado como pago no fluxo editorial
        if (statusPagamento === 'Pago' || statusPagamento === 'Cortesia' || statusPagamento === 'Pendente') {
            return statusTermo === 'Completo' ? 'Ag. Pub com Termo' : 'Ag. Pub sem Termo';
        }
    }
    
    if (statusAvaliacao === 'Pendente' && hasUpload) return 'Para Avaliar';
    
    return 'Aguardando Artigo';
};

async function test() {
  try {
    const { rows } = await pool.query("SELECT id, data FROM records WHERE id = 'A-0630'");
    const status = getArtigoFlowStatus(rows[0]);
    console.log('ID:', rows[0].id);
    console.log('Detected Status:', status);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

test();
