const express = require('express');
const https = require('https');
const router = express.Router();
const pool = require('../db');
const { decrypt } = require('../utils/crypto');

function makeRequest(options, bodyParams) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(bodyParams);
        options.headers = {
            ...options.headers,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, json });
                } catch (e) {
                    reject(new Error('Resposta inválida da API: ' + data.substring(0, 100)));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function groqRequest(apiKey, prompt) {
    const options = {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` }
    };
    const body = {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
        temperature: 0.8
    };
    return makeRequest(options, body);
}

function openRouterRequest(apiKey, prompt) {
    const options = {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://poisson.com.br',
            'X-Title': 'Poisson ERP'
        }
    };
    const body = {
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
        temperature: 0.8
    };
    return makeRequest(options, body);
}

function geminiRequest(apiKey, model, prompt, imageBase64) {
    const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1/models/${model}:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {}
    };
    
    const parts = [{ text: prompt }];
    if (imageBase64) {
        let cleanBase64 = imageBase64;
        let mimeType = 'image/jpeg';
        const match = imageBase64.match(/^data:(image\/\w+);base64,(.*)$/);
        if (match) {
            mimeType = match[1];
            cleanBase64 = match[2];
        }
        parts.push({ inline_data: { mime_type: mimeType, data: cleanBase64 } });
    }

    const body = {
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: 700, temperature: 0.8 }
    };
    return makeRequest(options, body);
}

router.post('/generate-caption', async (req, res) => {
    const { apiKey, apiKeys, prompt, image_base64 } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'O prompt é obrigatório.' });
    }

    const keys = apiKeys || { gemini: apiKey };
    const { gemini, groq, openrouter } = keys;

    if (!gemini && !groq && !openrouter) {
        return res.status(400).json({ error: 'Nenhuma chave de API fornecida.' });
    }

    let lastError = null;

    // Se houver imagem, Gemini é o único capaz (Vision). Se não, segue a ordem OpenRouter -> Groq -> Gemini
    const tryGemini = async () => {
        if (!gemini) return false;
        const models = ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
        for (const model of models) {
            try {
                const { status, json } = await geminiRequest(gemini, model, prompt, image_base64);
                if (status >= 200 && status < 300 && json.candidates?.[0]?.content?.parts?.[0]?.text) {
                    res.json({ text: json.candidates[0].content.parts[0].text, model: `gemini/${model}` });
                    return true;
                }
                const errMsg = json.error?.message || `HTTP ${status}`;
                lastError = `Gemini (${model}): ${errMsg}`;

                const lowerErr = errMsg.toLowerCase();
                if (status === 429 || status >= 500 || lowerErr.includes('not found') || lowerErr.includes('not supported') || lowerErr.includes('quota') || lowerErr.includes('exceeded')) {
                    continue;
                }
                break;
            } catch (err) {
                lastError = `Erro no Gemini (${model}): ${err.message}`;
            }
        }
        return false;
    };

    const tryGroq = async () => {
        if (!groq) return false;
        try {
            const { status, json } = await groqRequest(groq, prompt);
            if (status >= 200 && status < 300 && json.choices?.[0]?.message?.content) {
                res.json({ text: json.choices[0].message.content, model: 'groq/llama3-70b-8192' });
                return true;
            }
            lastError = `Groq devolveu status ${status}: ${JSON.stringify(json.error || json)}`;
        } catch (err) {
            lastError = `Erro na Groq: ${err.message}`;
        }
        return false;
    };

    const tryOpenRouter = async () => {
        if (!openrouter) return false;
        try {
            const { status, json } = await openRouterRequest(openrouter, prompt);
            if (status >= 200 && status < 300 && json.choices?.[0]?.message?.content) {
                res.json({ text: json.choices[0].message.content, model: 'openrouter/gemini-2.0-flash-lite-free' });
                return true;
            }
            lastError = `OpenRouter status ${status}: ${JSON.stringify(json.error || json)}`;
        } catch (err) {
            lastError = `Erro no OpenRouter: ${err.message}`;
        }
        return false;
    };

    if (image_base64) {
        if (await tryGemini()) return;
        // Se falhou ou não tem chave do gemini, tentamos o resto passando só texto (fallback gracefully)
        if (await tryGroq()) return;
        if (await tryOpenRouter()) return;
    } else {
        if (await tryGroq()) return;
        if (await tryOpenRouter()) return;
        if (await tryGemini()) return;
    }

    return res.status(500).json({ error: `Nenhum provedor de IA conseguiu responder. Último erro: ${lastError}` });
});

async function getApiKeyFromSettings(key) {
    try {
        const res = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
        if (res.rows.length > 0) {
            let val = res.rows[0].value;
            
            // Se veio do banco como string (coluna TEXT), tenta converter para objeto
            if (typeof val === 'string' && val.trim().startsWith('{')) {
                try { val = JSON.parse(val); } catch(e) {}
            }

            // Suporte ao formato { key: "..." } usado pelo ConfigView.jsx
            if (val && typeof val === 'object' && val.key) {
                val = val.key;
            }

            // Suporte ao novo formato { encrypted: "iv:content" }
            if (val && typeof val === 'object' && val.encrypted) {
                val = val.encrypted;
            }

            if (typeof val === 'string' && val.includes(':')) {
                return decrypt(val);
            }
            return (typeof val === 'string') ? val : null;
        }
    } catch (err) {
        console.error(`[AI Settings Error] Erro ao buscar ${key}:`, err.message);
    }
    return null;
}

router.post('/chat', async (req, res) => {
    const { messages, temperature, model: requestedModel } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'O campo messages é obrigatório e deve ser um array.' });
    }

    // Tenta pegar chaves do banco se não vierem no Header ou Body (simplificado aqui para usar as do banco)
    const geminiKey = await getApiKeyFromSettings('gemini_api_key');
    const groqKey = await getApiKeyFromSettings('groq_api_key');
    
    // Converte messages para prompt simples para os métodos existentes (ou poderíamos refatorar os métodos)
    const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

    let lastError = null;

    // Prioridade 1: Groq (via Llama 3)
    if (groqKey) {
        try {
            const { status, json } = await groqRequest(groqKey, prompt);
            if (status >= 200 && status < 300 && json.choices?.[0]?.message?.content) {
                return res.json({ 
                    choices: [{ message: { content: json.choices[0].message.content } }],
                    model: 'groq/llama3-70b' 
                });
            }
            lastError = `Groq: ${status}`;
        } catch (err) { lastError = err.message; }
    }

    // Prioridade 2: Gemini
    if (geminiKey) {
        const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
        for (const model of models) {
            try {
                const { status, json } = await geminiRequest(geminiKey, model, prompt);
                if (status >= 200 && status < 300 && json.candidates?.[0]?.content?.parts?.[0]?.text) {
                    return res.json({ 
                        choices: [{ message: { content: json.candidates[0].content.parts[0].text } }],
                        model: `gemini/${model}` 
                    });
                }
                lastError = `Gemini ${model}: ${status}`;
            } catch (err) { lastError = err.message; }
        }
    }

    res.status(500).json({ error: 'Nenhum provedor de IA disponível. Erro: ' + lastError });
});

router.post('/sumario/paginas', async (req, res) => {
    // Rota placeholder para evitar 404
    res.json({ success: true, message: 'Endpoint de páginas pronto.' });
});

const SYSTEM_HELP_MANUAL = `
# Manual Ultra-Detalhado: Poisson ERP (2026)

Você é o assistente de suporte do Poisson ERP — sistema de gestão editorial da Editora Poisson.
Responda SEMPRE em português, de forma direta. Use listas e passos numerados quando explicar como fazer algo.
Só use informações deste manual. Se não souber, diga "não tenho essa informação".

---

## IDENTIDADE DO SISTEMA

- **Nome**: Poisson ERP
- **Função**: Sistema de gestão editorial para controlar livros, artigos, autores, publicações e redes sociais
- **Acesso**: https://individual.poisson.com.br/login
- **Roles de usuário**: superadmin, admin, organizador, autor, user

---

## MENU LATERAL (SIDEBAR)

O sidebar fica à esquerda e está dividido em 3 seções:

### SEÇÃO CONTEÚDO
- **Artigos** (ícone de biblioteca): gerencia artigos para coletâneas
- **Acervo Digital** (ícone de camadas): gerencia todos os livros e e-books
- **Chamadas Abertas** (ícone de livro): gerencia "call for papers"

### SEÇÃO GESTÃO
- **Painel do Autor** (ícone de usuário): área restrita para autores externos
- **Dashboard** (ícone de gráfico): visão geral com KPIs
- **Configurações** (ícone de engrenagem): administração do sistema

### SEÇÃO APPS
- **Post Studio** (ícone de raio): publica nas redes sociais
- **Construtor de Sumário** (ícone de arquivo): organiza capítulos
- **Canva de Pobre** (ícone de estrelas): editor visual de designs
- **Padaria** (ícone de trigo): formata documentos Word

### Informações do usuário (rodapé do sidebar)
- Avatar com iniciais em amarelo
- Nome e role exibidos
- Cor do badge por role: roxo=admin, verde=organizador, azul=autor, cinza=user

### Controle de acesso por menu
- Admin/Superadmin: veem todos os menus
- Organizador: vê apenas menus com permissão habilitada em Configurações > Permissões
- Autor: acesso restrito ao Painel do Autor e suas submissões

---

## PREFIXOS DE ID

- **I-XXXX** = livro Individual (ex: I-0001)
- **C-XXXX** = Coletânea (ex: C-0042)
- **A-XXXX** = Artigo (ex: A-0015)

---

## ACERVO DIGITAL (ListView)

Tela principal de gerenciamento de todos os livros e coletâneas.

### Como acessar
Menu lateral → "Acervo Digital"

### Abas principais
1. **Visualização**: exibe e gerencia os registros
2. **Motores de Busca**: cria e gerencia filtros avançados salvos

### Aba VISUALIZAÇÃO

#### Cabeçalho
- Título "Acervo Digital" com ícone roxo de banco de dados
- Subtítulo: "Gestão completa do acervo de livros e e-books da Poisson"

#### Pipeline de Livros (BookPipeline)
Barra horizontal com etapas do fluxo editorial. Cada etapa mostra a quantidade de livros nela.
Etapas em ordem:
1. Para Editar
2. Conferência
3. Enviar Prova
4. Avaliação do Autor
5. Alterações
6. Para Publicar
7. Publicado

**Como usar o Pipeline:**
- Clique em uma etapa para filtrar apenas os livros daquela etapa
- Um chip aparece abaixo mostrando "Filtrando etapa: [nome]" com botão X para limpar
- O número dentro de cada etapa atualiza conforme os dados

#### Filtros por Tipo (Pills)
Três botões no topo:
- **Todos**: exibe todos os registros com contagem total
- **Individual** (ícone de livro azul): filtra apenas livros com ID iniciando em "I-"
- **Coletâneas** (ícone de pessoas roxo): filtra apenas registros com ID iniciando em "C-"
Cada pill mostra a quantidade entre parênteses.

#### Dropdown de Filtros Salvos
- Ícone de filtro azul com texto do filtro ativo
- Opção padrão: "TODOS OS LIVROS"
- Lista filtros salvos nos Motores de Busca
- Selecionar um filtro aplica as regras automaticamente e reseta para página 1

#### Campo de Busca
- Ícone de lupa + placeholder "Busca por título, autor, email..."
- Filtra em tempo real enquanto o usuário digita
- Campos pesquisados: título, nome de autores, email dos autores
- Ao digitar, volta para a página 1 automaticamente

#### Botões de Ação (lado direito)
1. **Botão de vista** (LayoutList / LayoutGrid): alterna entre modo Tabela e modo Cards
2. **Botão "Colunas"** (apenas no modo Tabela): abre o gerenciador de colunas
3. **Botão "Excel"** (ícone de download): exporta os registros filtrados para arquivo .xls
4. **Botão "+ Novo Registro"**: abre dropdown com:
   - "Individual" (ícone de livro azul) → cria novo livro individual
   - "Coletânea" (ícone de pessoas roxo) → cria nova coletânea
   Após clicar, abre automaticamente o formulário de detalhe para preencher

#### Gerenciador de Colunas
Aparece ao clicar em "Colunas" no modo tabela:
- Lista de checkboxes para cada coluna disponível
- Marque/desmarque para mostrar/ocultar colunas
- Botão "Fechar" para sair

#### Modo Tabela
- Colunas ordenáveis (clique no cabeçalho para ordenar)
- Paginação: 10, 25, 50 ou 100 linhas por página
- Clique em qualquer linha abre o detalhe do registro
- Cada linha mostra: ID, tipo, título, autor, status, data, etc.

#### Modo Cards (Grade)
- Grade de miniaturas de capas de livros
- Proporção 3:4 (como capa de livro)
- Cada card mostra:
  - Imagem da capa frontal (ou ícone de livro se não houver)
  - Ponto colorido no canto superior esquerdo: azul=individual, roxo=coletânea
  - ID do registro em texto pequeno na base
- **Badge de atraso** aparece quando o livro está parado há mais de 14 dias:
  - Amarelo com triângulo: 14 a 30 dias parado
  - Vermelho com triângulo: mais de 30 dias parado
  - Texto: "[N]d parado"
- Clique no card abre o detalhe

#### Estado Vazio
Se não houver registros: exibe ícone grande de banco de dados cinza + texto "NENHUM REGISTRO ENCONTRADO"

### Aba MOTORES DE BUSCA

#### Como criar um Motor de Busca
1. Clique na aba "Motores de Busca"
2. Clique em "Novo Filtro" (ou "+ Novo Motor")
3. Digite um nome para o filtro
4. Adicione blocos de regras clicando em "+ Adicionar Bloco"
5. Dentro de cada bloco, adicione regras clicando em "+ Adicionar Regra"
6. Para cada regra, escolha: campo, operador e valor
7. Defina se as regras do bloco usam AND (todos devem ser verdadeiros) ou OR (pelo menos um)
8. Defina se os blocos entre si usam AND ou OR
9. Clique em "Salvar" para salvar o filtro com o nome

#### Campos disponíveis para filtro no Acervo
- Todos os campos configurados nos Metadados

#### Como usar um filtro salvo
- Na aba Visualização, abra o dropdown de filtros
- Selecione o filtro desejado
- Os registros são filtrados automaticamente

#### Gerenciar filtros salvos
- Lista à esquerda: clique para selecionar/editar
- Botão de lápis: editar o filtro
- Botão de lixeira: deletar (pede confirmação)
- Botão de duplicar: cria cópia

---

## DETALHE DO REGISTRO (DetailView)

Tela de edição completa de um livro ou coletânea. Abre ao clicar em qualquer registro.

### Cabeçalho
- Chip azul com ID do registro (ex: "I-0001")
- Título grande da obra
- Indicador de tipo: "Coletânea" (roxo) ou "Individual" (azul)
- **Pipeline Visual**: barra clicável com as etapas de produção. Clique numa etapa para atualizar o status
- **Botão "Eliminar"** (vermelho, ícone de lixeira): deleta o registro após confirmação
- **Botão "Salvar Dados"** (azul, ícone de check): salva todas as alterações

### Sistema de Abas

#### Para Coletâneas — aba extra no início:
- **Montagem**: gerencia a estrutura de capítulos da coletânea

#### Abas padrão (todos os registros):
- Abas dinâmicas configuradas nos Metadados (variam por tipo)
- **Ficha Catalográfica**: dados bibliográficos para catalogação
- **Crossref**: registro e gestão de DOI
- **WordPress**: publicação no site
- **Comunicação**: envio de mensagens ao autor
- **Redes Sociais**: gestão de imagens para redes sociais
- **Arquivos**: navegador de arquivos do servidor

#### Para Artigos (appView='artigos') — substituem o padrão:
- **Cadastro**: dados básicos do artigo
- **Avaliação**: status e decisão do avaliador

### Tipos de campos nos formulários
- **text**: input de texto de uma linha
- **long_text**: textarea de múltiplas linhas (mínimo 120px)
- **select**: dropdown com lista de opções
- **date**: seletor de data
- **number**: número
- **currency**: valor monetário em BRL
- **authors**: gerenciador de lista de autores com nome, email, CPF, ORCID e minicurrículo. Botão "+" adiciona autor, botão "X" remove (mínimo 1 autor)
- **negotiator**: seletor de negociador/responsável
- **payment_status**: checkpoints de pagamento com cores (verde=pago, amarelo=pendente, vermelho=cancelado)
- **workflow**: timeline de etapas com datas de conclusão. Clique em cada etapa para marcar como concluída e registrar data
- **cover**: upload de capa frontal e traseira. Drag-and-drop ou clique para selecionar. Preview em tempo real
- **file**: upload de múltiplos arquivos. Drag-and-drop ou clique. Lista arquivos com botões de Download e Delete
- **button**: botão de ação especial. Ex: "Gerar Termo de Cessão" cria um documento Word com dados da obra

### Como salvar
1. Edite os campos desejados
2. Clique em "Salvar Dados" (botão azul com check)
3. Uma mensagem azul aparece no topo: "✓ Dados salvos com sucesso!"
4. A mensagem desaparece após 3 segundos

### Validações
- **Título obrigatório**: se o título estiver vazio, o sistema bloqueia o salvamento

### Aba: Ficha Catalográfica
Campos editáveis:
- Título, subtítulo
- Responsabilidade (autores/organizadores)
- Editora, local de publicação, UF, ano
- Formato (PDF, EPUB, etc.)
- Modo de acesso
- Número de páginas
- ISBN (com máscara automática: 978-XX-XXXX-X)
- DOI (gerado automaticamente: "10.36229/" + ISBN)
- CDD (Classificação Decimal de Dewey)
- Cutter (número de catalogação)
- Palavras-chave (tags, adicione e remova individualmente)
- Inclui bibliografia (checkbox)
- Nome da bibliotecária e número CRB

**Exportar ficha:**
- Botão PNG: exporta como imagem
- Botão Word: exporta como documento .docx

### Aba: Crossref (DOI)
- Exibe DOI atual do livro
- Permite registrar o DOI no sistema Crossref
- Campos: DOI, URL de acesso
- Credenciais usadas: as configuradas em Configurações > Chaves (Login ID e senha Crossref)

### Aba: WordPress
- Sincroniza dados com o site poisson.com.br
- Campos:
  - Descrição (texto longo)
  - Resumo
  - Área temática
  - Link "Ler Online"
  - Data de publicação
  - Product ID (WooCommerce)
  - Status (publish/draft)
- Botão "Sincronizar": envia dados para o WordPress via API REST
- Credenciais usadas: as configuradas em Configurações > Chaves (WordPress)

### Aba: Comunicação (MessagingTab)
- Envia mensagens ao autor do livro
- **Templates pré-definidos do sistema:**
  1. Confirmação de Submissão
  2. Resultado de Avaliação
  3. Solicitação de Termo de Cessão
  4. Confirmação de Publicação (com ISBN e DOI)
  5. Lembrete de Pendência
  6. Confirmação de Contrato
- **Templates customizados**: criados em Configurações > Mensagens
- **Dropdown de templates**: seção "──── Sistema ────" separa os templates do sistema dos customizados
- Campos editáveis: Assunto e Corpo da mensagem
- **Placeholders dinâmicos**: {{title}}, {{isbn}}, {{doi}}, {{today_date}}, {{negotiator_name}}
- Botão "Enviar": dispara a mensagem
- **Histórico**: aba ou seção mostrando mensagens anteriores enviadas para este livro

### Aba: Redes Sociais / Ativos (AtivosTab)
- Gerencia imagens do livro para uso em redes sociais
- Preview de como o livro apareceria em diferentes formatos
- Upload de imagens em formatos específicos (feed, stories, etc.)

### Aba: Arquivos (FileManagerTab)
- Navegador de pastas no servidor VPS
- Caminho padrão: "/individuais/{DOI}" para livros individuais
- Permite navegar entre pastas
- Ao selecionar um arquivo PDF/EPUB: salva a URL no campo correspondente do livro
- Navega automaticamente para a aba Crossref após selecionar arquivo

### Aba: Montagem (apenas Coletâneas)
Divide a tela em duas colunas:

**Coluna esquerda — Banco de Artigos:**
- Campo de busca por título ou autor
- Filtros: Livro, Status de Pagamento, Status de Avaliação, Status de Publicação
- Cards de artigos disponíveis com: ID, título, autor, capítulo atual
- Botão "Adicionar": associa o artigo à coletânea

**Coluna direita — Sumário Montado:**
- Lista de artigos já associados na ordem dos capítulos
- Numeração de capítulo automática
- Botões de reordenação ↑ e ↓
- Botão de remover artigo
- Botão "Dissociar Sumário": remove todos os artigos da coletânea
- Botão "Ordenar por IA": reorganização automática (funcionalidade em desenvolvimento)

**Validações da Montagem:**
- Livro não pode estar com status "Publicado"
- Um artigo não pode estar em múltiplas coletâneas simultaneamente
- Ao remover um artigo, a numeração dos capítulos é reordenada automaticamente

---

## ARTIGOS (ArtigosView)

Gerencia os artigos submetidos para coletâneas.

### Como acessar
Menu lateral → "Artigos"

### Painel de Status Superior
Cards clicáveis que filtram a lista:
- **Avaliação**: Pendente | Aprovado | Reprovado (com contagens)
- **Pagamento**: Aguardando | Pago | Cancelado (com contagens)
- Clique em qualquer status para filtrar. Clique novamente para remover o filtro.

### Abas
1. **Lista**: tabela com todos os artigos
2. **Motores de Busca**: filtros avançados salvos (mesmo funcionamento do Acervo Digital)

### Aba Lista

#### Tabela de artigos
Colunas principais: ID, Título, Autor, Livro, Status Avaliação, Status Pagamento, Data Prevista

#### Botão "Exportar Excel"
- Exporta todos os artigos visíveis para .xls

#### Clique em um artigo
Abre o formulário completo do artigo com as abas:

### Formulário do Artigo

#### Aba: Cadastro
- **Título da obra** (obrigatório): título completo do artigo
- **Livro Escolhido**: dropdown com as coletâneas disponíveis
- **Autores**: lista de autores. Para cada autor:
  - Nome completo
  - Email
  - ORCID
  - Minicurrículo (texto)
  - Botão "+" para adicionar autor
  - Botão "X" para remover (mínimo 1)
- **Observações para a Editora**: textarea livre
- **Uploads de arquivo**:
  - Arquivo Original (Word/PDF do artigo)
  - Termo de Cessão (PDF assinado)
  - Artigo Editado (versão revisada)
- **Botão "Auto Formatação (Padaria)"**:
  1. Pega o tema de cores salvo nos 16 modelos da Padaria
  2. Baixa o arquivo original do servidor
  3. Envia para o serviço de formatação (/academic/format)
  4. Faz download automático do arquivo formatado com sufixo "_formatado.docx"
  - Requer que o arquivo original esteja anexado

#### Aba: Avaliação
- **Data da Avaliação**: seletor de data
- **Status da Avaliação**: dropdown (opções configuradas em Metadados > Campos do Sistema)
  - Padrão: Pendente | Aprovado | Reprovado
- **Livro Sugerido**: texto livre para sugestão do avaliador
- **Taxa de Publicação**: dropdown com valores em BRL (configurado em Metadados > Campos do Sistema > Taxa de Publicação)
- **Parecer do Avaliador**: textarea longo
- **Status de Pagamento**: dropdown (configurado em Campos do Sistema)
  - Padrão: Aguardando | Pago | Cancelado
- **Status do Termo de Cessão**: dropdown (configurado em Campos do Sistema)
  - Padrão: Não enviado | Enviado | Assinado
- **Data Prevista de Publicação**: seletor de data
- **Considerações Finais**: textarea longo

#### Aba: Publicação
- **Status da Publicação**: dropdown (configurado em Campos do Sistema)
  - Padrão: Não publicado | Publicado
- **ISBN**: campo de texto
- **DOI**: campo de texto (formato: 10.XXXX/...)
- **DOI do Capítulo**: campo de texto

### Motores de Busca em Artigos

#### Campos filtrávéis
- Título do Documento (texto): Contém, Não contém, É igual a, Diferente de, Começa com, Vazio, Não vazio
- Livro Escolhido (texto): mesmos operadores
- Autor Principal (texto): mesmos operadores
- Observações (texto): mesmos operadores
- Status de Avaliação (select): É, Não é, Vazio, Não vazio
- Status de Pagamento (select): É, Não é, Vazio, Não vazio
- Status do Termo (select): É, Não é, Vazio, Não vazio
- Data Prevista de Publicação (data): É igual a, Após, Antes de, Vazio, Não vazio
- Capítulo (número): Igual a, Diferente de, Maior que, Menor que, Vazio, Não vazio
- ISBN (texto): mesmos operadores de texto
- DOI (texto): mesmos operadores de texto

---

## CONFIGURAÇÕES (ConfigView)

Central administrativa com 6 abas. Acessível no menu lateral.

### Aba: CHAVES

#### WordPress
- **URL do Site**: endereço do site WordPress (ex: https://poisson.com.br)
- **Usuário WordPress**: login de admin do WordPress
- **Senha de App**: senha de aplicativo gerada no WordPress (não é a senha normal)

#### Crossref / DOI
- **Login ID**: login no Crossref (padrão: pois)
- **Senha Crossref**: senha da conta Crossref

#### VPS
- **Senha da VPS**: senha de acesso SSH ao servidor

#### Inteligência Artificial
- **Groq API Key**: chave da API Groq (gsk_...)
- **OpenRouter API Key**: chave da API OpenRouter (sk-or-...)
- **Gemini API Key**: chave da API Google Gemini (AIza...)
- Prioridade de uso: Groq primeiro → OpenRouter → Gemini como fallback

#### Tawk.to Live Chat
- **Property ID**: ID da propriedade no Tawk.to
- **Widget ID**: ID do widget do chat

#### E-mail / SMTP
- **Host SMTP**: servidor de email (ex: email-smtp.us-east-1.amazonaws.com)
- **Porta**: padrão 587
- **Usuário SMTP**: login do servidor SMTP
- **Senha SMTP**: senha do SMTP
- **Nome Remetente**: nome que aparece no email (ex: Poisson ERP)
- **Email Remetente**: endereço de envio

#### Google OAuth (Login Social)
- **Google Client ID**: ID do cliente OAuth
- **Google Client Secret**: chave secreta OAuth

**Como salvar todas as chaves:**
Clique no botão "Salvar Chaves" no canto inferior direito da página.

**Dica:** Todas as senhas têm botão de olho (👁) para mostrar/ocultar o valor.

### Aba: METADADOS (FormLayoutBuilder)

Configura os campos dos formulários de cada tipo de registro.

#### Banco de Campos
- Lista de campos customizáveis
- Para cada campo é possível:
  - Editar o nome (label)
  - Mudar o tipo (text, select, date, file, cover, authors, etc.)
  - Para campos do tipo "select": definir as opções disponíveis
  - Reordenar via drag-and-drop (segurar o ícone de grade lateral)
  - Duplicar o campo
  - Deletar o campo (com confirmação)
  - Mostrar/ocultar o campo (toggle de visibilidade)
- Cada campo pode ocupar de 1 a 12 colunas no grid do formulário

#### Botão "+ Adicionar Campo"
Cria um novo campo vazio no banco de campos.

#### Campos do Sistema (box separado, abaixo do Banco de Campos)
Campos protegidos que NÃO podem ser apagados nem renomeados, apenas editados:

1. **Status da Avaliação** (tipo: select)
   - Opções padrão: Pendente, Aprovado, Reprovado
   - Edite para adicionar/remover opções

2. **Status do Pagamento** (tipo: select)
   - Opções padrão: Aguardando, Pago, Cancelado

3. **Status do Termo de Cessão** (tipo: select)
   - Opções padrão: Não enviado, Enviado, Assinado

4. **Status da Publicação** (tipo: select)
   - Opções padrão: Não publicado, Publicado

5. **Taxa de Publicação** (tipo: publication_fee)
   - Cada opção tem dois valores: Valor de Face (exibido ao usuário) e Valor Interno
   - Ex: Valor de Face = "R$ 350,00", Valor Interno = "350"
   - Adicione/remova opções de taxa conforme necessário

6. **ISBN** (tipo: text) — somente leitura no formulário
7. **DOI** (tipo: text) — somente leitura no formulário
8. **DOI do Capítulo** (tipo: text) — somente leitura no formulário

### Aba: MENSAGENS

#### URL do Webhook n8n
- Campo para inserir o endpoint n8n que receberá as postagens do Post Studio
- Padrão: https://n8.poisson.com.br/webhook/erp-publicar-redes

#### Templates de Mensagem
Lista de templates de email para enviar aos autores:
- Botão "+ Novo Modelo": cria template vazio
- Para cada template:
  - **Nome** do template (identificador)
  - **Assunto** do email
  - **Corpo** da mensagem (editor rich text CKEditor com formatação completa)
  - Pré-visualização em formato A4
  - Botão de deletar

**Variáveis disponíveis nos templates:**
- {{title}}: título da obra
- {{isbn}}: ISBN do livro
- {{doi}}: DOI do livro
- {{today_date}}: data de hoje
- {{work_title}}: título alternativo
- {{negotiator_name}}: nome do negociador

#### Templates do Sistema (não deletáveis)
Aparecem no dropdown do MessagingTab com separador "──── Sistema ────":
1. Redefinição de Senha
2. Boas-vindas ao Sistema
3. Código de Acesso (OTP)
4. Confirmação de Submissão (para o autor)
5. Notificação de Nova Submissão (para o admin)

### Aba: BACKUP

- **Botão "Baixar Backup"**: faz download completo do banco de dados
- **Upload de Backup**: área para enviar arquivo de backup e restaurar
- Útil antes de grandes alterações no sistema

### Aba: USUÁRIOS

- Lista de todos os usuários cadastrados
- Para cada usuário: nome, email, role, data de criação
- **Botão "+ Novo Usuário"**: formulário com nome, email, senha e role
- **Editar**: altera dados do usuário
- **Deletar**: remove usuário (com confirmação)

**Roles disponíveis:**
- superadmin: acesso total irrestrito
- admin: acesso total ao sistema
- organizador: acesso configurável por permissões
- autor: vê apenas suas submissões
- user: acesso básico

### Aba: PERMISSÕES

- Matriz de permissões por role
- Para o role "organizador", defina quais menus e funcionalidades ele pode acessar
- Cada item tem um toggle (ligado/desligado)
- Salve após alterar

---

## POST STUDIO — REDES SOCIAIS (SocialMediaView)

Ferramenta de criação e publicação de posts para redes sociais.

### Como acessar
Menu lateral → "Post Studio"

### Layout da Tela

#### Galeria de Mídia (lado esquerdo ou painel superior)
**Abas:**
- **Imagens**: lista imagens disponíveis
- **Vídeos**: lista vídeos disponíveis

**Como fazer upload:**
1. Clique em "Fazer Upload" (ícone de nuvem)
2. Selecione um ou mais arquivos
3. Progresso exibido: "1/5", "2/5", etc.
4. Arquivos aparecem na galeria após conclusão

**Selecionar mídia:**
- Clique em qualquer imagem/vídeo para selecioná-la
- A mídia selecionada fica destacada com borda

**Deletar mídia:**
- Ícone de lixeira sobre a imagem
- Pede confirmação antes de excluir

**Estado vazio:**
- Ícone de nuvem + texto "Nenhum arquivo na galeria"
- Texto: "Clique em 'Fazer Upload' para começar"

#### Seleção de Redes Sociais
Chips clicáveis (múltipla seleção):
1. **Instagram Feed** (ig-feed): formato 4:5, ícone Instagram
2. **Instagram Story** (ig-story): formato 9:16, ícone Instagram
3. **Facebook Feed** (fb-feed): formato 1:1, ícone Facebook
4. **Facebook Story** (fb-story): formato 9:16, ícone Facebook
5. **WhatsApp Status** (wa-story): formato 9:16, ícone WhatsApp

Chip ativo = colorido com gradiente da rede. Clique para ativar/desativar.

#### Área de Texto (Legenda/Copywriting)
- Textarea grande para digitar a legenda do post
- **Emoji Picker**: botão de emoji abre painel com 24 emojis categorizados:
  - ✨🚀📚🎓👇🔗🎯💡🔥❤️🎉✅✔️⬇️👏💬📖🖋️🏫🧪🌍🧠📅📍
  - Clique no emoji para inserir no texto

#### Geração por IA
- Campo "Descreva o post" para prompt
- Toggle "Vision": ativa análise visual da imagem selecionada
- Botão "Gerar": chama a IA (Groq/Gemini/OpenRouter)
- Resultado aparece em caixa separada
- Botão "Aceitar": insere o texto gerado na legenda (se já houver texto, adiciona após dois Enter)

#### Templates de Legenda
- Dropdown "Usar template"
- Lista templates salvos em Configurações > Mensagens
- Selecionar insere o template na legenda

#### Publicar
**Pré-condições:**
- Pelo menos uma rede social selecionada
- Mídia selecionada na galeria

**Botão "Publicar":**
1. Envia a mídia (URL ou base64) + legenda + redes selecionadas para o backend
2. Backend processa a imagem (ajusta proporção se necessário)
3. Encaminha para o n8n (https://n8.poisson.com.br/webhook/erp-publicar-redes)
4. n8n publica nas redes selecionadas
5. Resultado aparece como toast verde (sucesso) ou vermelho (erro)
6. Toast desaparece após 5 segundos

**Processamento de imagem pelo backend:**
- Se a rede inclui feed: ajusta para proporção 4:5 máxima (adiciona bordas brancas se necessário)
- Se inclui story: ajusta para 9:16 (adiciona bordas se necessário)

#### Histórico de Posts
- Seção ou aba separada listando posts enviados
- Cada item: data/hora, legenda (resumida), redes, status (Sucesso/Falha)

---

## CANVA DE POBRE — EDITOR VISUAL (CanvaPobreView + MockupBuilder)

Editor de design gráfico para criar artes, mockups e layouts.

### Como acessar
Menu lateral → "Canva de Pobre"

### Tela Principal (Lista de Templates)

#### Cabeçalho
- Logo "P" âmbar + título "CANVA DE POBRE"
- Subtítulo: "Apps & Criativos"

#### Filtro por Pasta
- Dropdown ou pills de pastas: "Todos", "Para Livros", "Certificados", etc.
- Clique em uma pasta para ver apenas seus templates

#### Lista de Templates
- Grid de cards, cada um com:
  - Thumbnail do design
  - Nome do template
  - Formato (ex: "4:5", "9:16")
  - Indicador de rascunho (se isDraft=true)
- **Clique** em um template para abrir o editor

#### Botões por Template
- **Editar**: abre no editor
- **Renomear**: prompt para novo nome
- **Duplicar**: cria cópia (com sufixo "Cópia")
- **Duplicar para Formato**: abre modal para escolher outro formato — os elementos são reposicionados proporcionalmente
- **Deletar**: pede confirmação

#### Botão "+ Novo Mockup"
1. Cria novo template vazio com nome "Novo Mockup N"
2. Salva como rascunho (isDraft=true)
3. Abre automaticamente no editor
4. Formato padrão: Feed Vertical (4:5)

### Editor Visual (MockupBuilder)

#### Formatos disponíveis
1. **Feed Vertical** (1080x1350px, 4:5) — Instagram Feed
2. **Stories/Reels** (1080x1920px, 9:16) — Instagram/Facebook Stories
3. **Post Quadrado** (1080x1080px, 1:1) — Post quadrado
4. **A4 Retrato** (1240x1754px) — Para impressão
5. **A4 Paisagem** (1754x1240px) — Para impressão horizontal
6. **Custom** — dimensões personalizadas

#### Layout do Editor
- **Canvas** (centro): área de design com zoom e pan
- **Painel de Ferramentas** (esquerda ou topo): adicionar elementos
- **Painel de Propriedades** (direita): editar elemento selecionado
- **Lista de Camadas** (lateral): ver e reordenar elementos

#### Adicionar Elementos

**Texto:**
1. Clique no ícone de texto (Type) na barra de ferramentas
2. Um elemento de texto é adicionado ao canvas
3. Clique duas vezes para editar o texto
4. Propriedades: fonte, tamanho, cor, bold, italic, underline, alinhamento (esquerda/centro/direita)
5. Fontes disponíveis: Google Fonts (Poppins, Montserrat, etc.) e fontes do sistema (Arial, Times, etc.)

**Imagem:**
1. Clique no ícone de imagem (Image) na barra de ferramentas
2. Opções:
   - Upload do computador
   - Busca de stock (Pexels/Unsplash)
   - Biblioteca do usuário (imagens já carregadas)
3. Após adicionar, clique para selecionar e aplicar máscara (forma da imagem):
   - Retângulo, Círculo, Coração, Estrela, Hexágono, Triângulo

**Formas:**
- Retângulo (Square): quadrado ou retângulo com cor de fundo
- Círculo (CircleIcon): forma oval/circular
- Linha (Minus): linha horizontal

**Biblioteca de Elementos:**
Elementos pré-desenhados em categorias:
- **Selos/Emblemas**: Garantia, Premium, Novo, Segurança, Preço
- **Bordas**: Dupla, Polaroid, Ouro, Suave
- **Ornamentos**: Estrela, Coração, Seta, Aspas, Divisor
- **Formas**: Hexágono, Losango, Bolha, Pílula
- **Fitas**: Central, Canto

#### Editar Elemento Selecionado
Clique em qualquer elemento no canvas para selecionar. Aparece:
- **Handles de canto**: arrastar para redimensionar
- **Alça central**: arrastar para mover
- **Painel de propriedades:**
  - Posição X, Y (em pixels)
  - Tamanho Width, Height
  - Rotação (graus, 0 a 360)
  - Opacidade (0% a 100%)
  - Z-index (profundidade/ordem de camadas)
  - Cor de fundo
  - Cor do texto (para elementos de texto)
  - Sombra, blur

#### Ações no Elemento
- **Copiar Estilo**: copia formatação para outros elementos
- **Duplicar**: cria cópia do elemento
- **Trazer para Frente / Enviar para Trás**: altera Z-index
- **Deletar**: remove elemento (botão de lixeira ou tecla Delete)
- **Flip Horizontal / Flip Vertical**: espelha o elemento
- **Rotacionar**: campo de graus no painel

#### Múltiplas Páginas
- Painel de páginas (abas ou lista) na parte inferior ou lateral
- Botão "+" para adicionar nova página
- Clique em uma página para navegar
- Botão de duplicar página
- Botão de deletar página

#### Background do Canvas
- **Cor sólida**: seletor de cor
- **Imagem**: upload de imagem de fundo
- **Gradiente**: degradê simples

#### Undo e Redo
- Undo (Ctrl+Z): desfaz última ação
- Redo (Ctrl+Y): refaz ação desfeita
- Botões Undo2/Redo2 na barra de ferramentas

#### Salvar Template
- Botão "Salvar" (ícone de disquete): salva o template no servidor
- Se for rascunho (isDraft): remove flag de rascunho após salvar
- Toast de confirmação ao salvar

#### Exportar/Download
- Botão "Download": exporta o canvas como imagem PNG
- Se múltiplas páginas: pode exportar como GIF animado
- Qualidade: alta resolução conforme dimensões do formato

#### Duplicar para Outro Formato
1. Na lista de templates, clique em "Duplicar para Formato"
2. Modal mostra formatos disponíveis (exceto o atual)
3. Escolha o formato de destino
4. O sistema recalcula posição e tamanho de todos os elementos proporcionalmente
5. Fontes também são escaladas uniformemente
6. Novo template criado como rascunho

---

## PADARIA — FORMATADOR ACADÊMICO (AcademicFormatter)

Formata documentos Word (.docx) seguindo o padrão editorial da Poisson.

### Como acessar
Menu lateral → "Padaria" (ícone de trigo)

### Tela Principal

#### Cabeçalho
- Ícone vermelho de trigo
- Título: "Formatador Acadêmico"

#### Catálogo de Modelos de Capa
16 miniaturas de capas pré-desenhadas em grade.

**Selecionar um modelo:**
- Clique na miniatura para ativar
- Modelo ativo mostra badge "ATIVO" vermelho no topo

**Personalizar cores do modelo:**
1. Passe o mouse sobre a miniatura
2. Clique em "Edit" (ícone de conta-gotas)
3. Modal abre com categorias de cor:
   - **Título das Seções**: cor dos títulos de capítulos
   - **Capítulo X**: cor do texto "Capítulo 1", "Capítulo 2", etc.
   - **Título do Artigo**: cor do título principal do documento
   - **Autores**: cor dos nomes de autores
   - **Resumo**: cor da seção de abstract/resumo
   - **Título Interno**: cor de subtítulos internos
   - **Cabeçalho/Rodapé**: cor do cabeçalho e rodapé das páginas
4. Para cada categoria:
   - Clique em uma das 23 cores da paleta pré-definida
   - OU digite o código hexadecimal manualmente (#RRGGBB)
   - OU use o conta-gotas (EyeDropper) para capturar cor da tela (apenas Chrome/Edge)
5. A paleta inclui: tons de vermelho, rosa, roxo, azul, verde, amarelo, laranja, marrom, cinza, preto e branco

**Salvar temas:**
- Botão "Salvar Temas": persiste as cores de todos os 16 modelos no localStorage do navegador
- Os temas salvos são usados também pelo botão "Auto Formatação" nos artigos

#### Configuração de Indentação
- Toggle ligado/desligado
- Ativado: mantém recuo de 1,25cm nos parágrafos (padrão ABNT)
- Desativado: remove todos os recuos

#### Upload do Documento
- Área de drag-and-drop ou clique para selecionar arquivo
- Aceita: .docx (Word)
- Ao selecionar: mostra nome do arquivo com ícone de check verde

#### Botão "Formatar"
1. Envia o arquivo + tema de cores selecionado + configuração de indentação
2. Destino: backend "/academic/format" (ou localhost:8030 em modo local)
3. Logs aparecem em tempo real no painel de logs (direita):
   - "Iniciando processamento..."
   - "Conectando ao servidor..."
   - "Enviando para: [URL]"
   - "Documento recebido! Preparando download..."
   - "Download disponível."

#### Download do Resultado
- Após processar, botão "Baixar" aparece (ou download automático)
- Arquivo retornado: documento .docx formatado com o tema escolhido

#### Painel de Logs
- Fundo escuro (slate-900)
- Ponto verde piscando: "Sistema Ativo"
- Lista de mensagens com horário
- Máximo 300px de altura (scrollável)

---

## PAINEL DO AUTOR (AuthorPanelView)

Área restrita para autores externos acompanharem suas submissões.

### Como acessar
Menu lateral → "Painel do Autor" (ou login direto como autor)

### Tela Principal

#### Lista de Submissões
Para cada artigo submetido, exibe:
- Título do artigo
- Status de Avaliação: Aceito (verde), Reprovado (vermelho), Pendente (amarelo)
- Status de Pagamento: Pago (verde), Aguardando (laranja)
- Nome do livro/coletânea ao qual pertence
- Data prevista de publicação
- Status atual: "Em Edição", "Publicado", etc.

#### Clique em uma submissão
Abre detalhes com:
- **Histórico de eventos**: timeline com datas e descrições (ex: "Submissão inicial realizada", "Em avaliação pelos pares")
- **Status de documentos**: verificação de arquivos enviados
- **Download**: baixar documentos relacionados

#### Upload de Arquivos (via formulário)
- Campo "Livro Escolhido": seleciona a coletânea
- Campo "Arquivo do Artigo": upload do .docx
- Campo "Termo de Cessão": upload do PDF assinado
- Botão "Salvar": envia ao servidor

---

## CHAMADAS ABERTAS (ChamadasAbertas)

Gerencia as chamadas para submissão de artigos.

### Como acessar
Menu lateral → "Chamadas Abertas"

### Lista de Chamadas
- Cada chamada mostra: título, status (Publicado/Rascunho), prazo, taxa, organização
- Clique para editar

### Criar Nova Chamada
Botão "+ Nova Chamada" abre formulário com:
- **Título**: nome da chamada
- **Prazo de Submissão** (campo: submissao-ate-): data limite
- **Data de Publicação** (campo: publicacao-em-): data prevista
- **Taxa de Publicação**: valor em reais
- **Organização**: nome da instituição promotora
- **Descrição**: editor rich text com formatação completa
- **Capa**: upload de imagem de capa
- **Status**: Publicado (publish) ou Rascunho (draft)

### Sincronizar com WordPress
- Botão "Sincronizar GF8": atualiza o Gravity Forms do site WordPress com as chamadas cadastradas
- O Gravity Forms 8 é o formulário de submissão do site poisson.com.br
- A sincronização atualiza o dropdown de coletâneas disponíveis para submissão
- Credenciais usadas: as configuradas em Configurações > Chaves (WordPress)

---

## FICHA CATALOGRÁFICA (FichyContainer)

Componente acessado pela aba "Ficha Catalográfica" dentro do Detalhe do Registro.

### Campos Gerenciados

#### Identificação da Obra
- **Título**: título principal
- **Subtítulo**: subtítulo (opcional)
- **Responsabilidade**: tipo de autoria (Autor, Organizador, Editor, etc.)
- **Nomes**: lista de autores. Botão "+" adiciona, botão "X" remove

#### Edição e Publicação
- **Editora**: nome da editora (padrão: Editora Poisson)
- **Local**: cidade de publicação (padrão: Belo Horizonte)
- **UF**: estado (padrão: MG)
- **Ano**: ano de publicação

#### Formato e Acesso
- **Formato**: tipo de arquivo (padrão: PDF)
- **Modo de Acesso**: como acessar (padrão: World Wide Web)
- **Páginas**: número de páginas

#### Identificadores Bibliográficos
- **ISBN**: com máscara automática 978-XX-XXXX-X. O DOI é gerado automaticamente como "10.36229/" + ISBN
- **CDD**: Classificação Decimal de Dewey (ex: 020.0)
- **Cutter**: número Cutter para catalogação

#### Conteúdo
- **Palavras-chave**: tags. Botão "+" adiciona, clique na tag remove
- **Inclui Bibliografia**: checkbox (padrão: marcado)

#### Dados do Bibliotecário
- **Bibliotecária**: nome (padrão: Sônia Márcia Soares de Moura)
- **CRB**: registro (padrão: 6/1896)

### Preview da Ficha
- Exibido em tempo real conforme edição
- Formato visual padrão de ficha catalográfica de livro

### Exportar
- **PNG**: gera imagem da ficha via html2canvas. Checkbox de fundo transparente disponível
- **Word**: gera arquivo .docx da ficha via API backend

---

## ERROS COMUNS E SOLUÇÕES

**"Failed to fetch" ou "Erro ao conectar"**
→ Backend offline ou conexão perdida. Aguarde 1 minuto e recarregue a página. Se persistir, o servidor VPS pode estar em manutenção.

**Tela branca ao abrir (especialmente no Firefox)**
→ Cache desatualizado. Pressione Ctrl+Shift+Del → marque APENAS "Cache temporário" → Período: Tudo → clique "Limpar". Em modo privativo do Firefox a tela branca não ocorre.

**"Não autorizado" ou redirecionado ao login**
→ Sessão expirada. Faça logout clicando no ícone de saída e faça login novamente.

**"Falha no upload" ou upload travado**
→ Arquivo provavelmente maior que 100MB. Comprima o arquivo antes de enviar.

**"Nenhum provedor de IA disponível"** (Assistente ou Post Studio)
→ Nenhuma chave de API configurada. Vá em Configurações → Chaves → configure pelo menos uma chave (Groq, Gemini ou OpenRouter) → clique em "Salvar Chaves".

**IA retorna erro mesmo com chave configurada**
→ Clique em "Salvar Chaves" novamente para re-aplicar as chaves. Às vezes ocorre falha na criptografia ao salvar.

**Post Studio: publicação enviada mas não aparece nas redes**
→ O n8n recebeu a postagem mas as credenciais das redes sociais no n8n expiraram. Acesse n8.poisson.com.br e reconecte as contas do Instagram/Facebook/WhatsApp no workflow "erp-publicar-redes".

**Campos do formulário não aparecem / formulário vazio**
→ Metadados não configurados. Vá em Configurações → Metadados e adicione os campos desejados.

**"ID Inválido" ou campos select em branco**
→ Metadados precisam ser recarregados. Saia da página e volte, ou pressione F5.

**Crossref retorna erro de autenticação**
→ Verifique em Configurações → Chaves se o Login ID (padrão: pois) e a senha do Crossref estão corretos.

**WordPress não sincroniza**
→ Verifique a URL, usuário e senha de app do WordPress em Configurações → Chaves. A senha de app é gerada em: WordPress Admin → Usuários → Perfil → Senhas de Aplicativo.

**Padaria não formata o documento**
→ O serviço de formatação (backend academic na porta 8030) pode estar offline. Contate o suporte.

**Auto Formatação no artigo falha**
→ O artigo precisa ter o "Arquivo Original" anexado. Vá na aba Cadastro e faça o upload do arquivo .docx primeiro.

---

## DICAS E ATALHOS

- **Busca rápida**: no Acervo Digital, a busca textual pesquisa título, autor e email simultaneamente
- **Livros atrasados**: no modo Cards do Acervo, procure pelos badges vermelhos (30+ dias) ou amarelos (14-30 dias)
- **Filtro rápido por etapa**: clique diretamente em uma etapa do Pipeline para filtrar sem precisar de Motor de Busca
- **Reutilizar filtros**: salve Motores de Busca com nomes descritivos (ex: "Livros para publicar", "Pendentes de pagamento")
- **Múltiplas redes de uma vez**: no Post Studio, selecione vários chips antes de publicar
- **Reaproveitar design**: no Canva de Pobre, use "Duplicar para Formato" para criar Story a partir de um Feed sem refazer tudo
- **Tema da Padaria**: personalize e salve o tema de cores uma vez. Ele será usado automaticamente no botão "Auto Formatação" dos artigos
- **Sessão**: o token de autenticação fica no sessionStorage — fechar o navegador completamente exige novo login
- **Senhas visíveis**: em Configurações → Chaves, clique no ícone de olho para ver a senha antes de salvar

---

## 1. ACERVO DIGITAL

Gerencia todos os livros individuais e coletâneas publicados ou em produção.

### Abas:
- **Visualização**: Lista ou grade de registros
- **Motores de Busca**: Filtros avançados salvos

### Modos de visualização:
- **Tabela**: Lista com colunas ordenáveis, paginação (10/25/50/100 por página)
- **Cards**: Grade de capas em proporção 3:4, com indicador colorido (azul = individual, roxo = coletânea)

### Filtros disponíveis:
- Por tipo: Todos | Individual | Coletânea (com contadores)
- Pipeline de status: clique em qualquer etapa para filtrar
- Busca textual: título, autor, email
- Motores de Busca avançados com lógica AND/OR

### Pipeline de status (ordem das etapas):
Para Editar → Conferência → Enviar Prova → Avaliação do Autor → Alterações → Para Publicar → Publicado

### Badges de atraso:
- Amarelo: livro parado há 14-30 dias
- Vermelho: parado há mais de 30 dias

### Ações disponíveis:
- **Novo Registro**: dropdown com "Individual" ou "Coletânea"
- **Gerenciar Colunas**: mostrar/ocultar colunas da tabela
- **Exportar Excel**: baixa todos os registros filtrados como .xls
- Clique em qualquer linha abre o Detalhe do Registro

### Motores de Busca:
- Crie filtros complexos com múltiplos blocos de regras
- Cada bloco pode usar AND ou OR internamente
- Os blocos entre si também podem ser AND ou OR
- Salve com um nome para reutilizar depois
- Filtros salvos ficam listados à esquerda; clique para ativar

---

## 2. DETALHE DO REGISTRO (DetailView)

Abre ao clicar em qualquer livro/coletânea no Acervo.

### Cabeçalho:
- ID, título, tipo (Individual/Coletânea)
- Pipeline visual clicável
- Botão Salvar

### Abas dinâmicas (configuradas em Metadados):
Cada aba exibe campos customizáveis. Os tipos de campo disponíveis são:
- **text**: campo de texto simples
- **long_text**: caixa de texto grande
- **select**: dropdown com opções configuráveis
- **date**: seletor de data
- **number / currency**: número ou valor em BRL
- **authors**: lista de autores (nome, email, ORCID, minicurrículo)
- **negotiator**: seletor de negociador/contato
- **payment_status**: checkpoints de pagamento com cores
- **workflow**: timeline de etapas de produção com datas
- **cover**: upload de capa frontal e traseira com preview
- **file**: upload de múltiplos arquivos (drag-and-drop)
- **button**: ação especial (ex: gerar Termo de Cessão em Word)

### Abas especializadas fixas:

**Ficha Catalográfica**:
- Campos: CDD, páginas, palavras-chave, subtítulo, local, UF, formato, modo de acesso, cutter, bibliotecária, CRB

**Crossref (DOI)**:
- Registrar o livro no Crossref para obter DOI
- Campos: DOI, URL do registro

**WordPress**:
- Sincroniza com site poisson.com.br
- Campos: descrição, resumo, área temática, link "ler online", data, product ID, status de publicação

**Gerenciador de Arquivos**:
- Navegador de pastas no servidor
- Associa URL do PDF/e-book ao registro

**Comunicação**:
- Histórico de mensagens enviadas ao autor
- Envio com templates (ex: Termo de Cessão)
- Substituições dinâmicas: {{title}}, {{isbn}}, {{doi}}, {{today_date}}, etc.

**Redes Sociais / Ativos**:
- Preview do livro para redes sociais
- Gerencia imagens em diferentes formatos

**Montagem (apenas Coletâneas)**:
- Divide a tela em 2: Banco de Artigos (esquerda) e Sumário Montado (direita)
- Banco de artigos: busca por título/autor, filtra por livro/status
- Sumário: reordena capítulos, remove artigos, dissocia sumário inteiro

---

## 3. ARTIGOS

Gerencia artigos submetidos para inclusão em coletâneas.

### Painel superior (cards de status):
- Avaliação: Pendente | Aprovado | Reprovado
- Pagamento: Aguardando | Pago | Cancelado
- Clique em qualquer card para filtrar a lista

### Abas:
- **Lista**: tabela de artigos com filtros
- **Motores de Busca**: filtros salvos (igual ao Acervo)

### Campos pesquisáveis nos filtros:
Título, Livro Escolhido, Autor Principal, Observações, Status de Avaliação, Status de Pagamento, Status de Termo, Data Prevista de Publicação, Capítulo, ISBN, DOI

### Ações:
- Exportar Excel
- Clicar na linha abre o formulário completo do artigo

### Formulário do artigo (abas):

**Cadastro**:
- Título da obra (obrigatório)
- Livro escolhido
- Autores: nome, email, ORCID, minicurrículo
- Observações para a editora
- Uploads: Arquivo Original (Word/PDF), Termo de Cessão, Artigo Editado
- Botão "Auto Formatação (Padaria)": processa o documento com tema salvo

**Avaliação**:
- Data da avaliação
- Status da avaliação (configurável em Campos do Sistema)
- Livro sugerido
- Taxa de publicação (valores BRL configurados em Metadados > Campos do Sistema)
- Parecer do avaliador
- Status de pagamento
- Status do Termo de Cessão
- Data prevista de publicação
- Considerações finais

**Publicação**:
- Status de publicação
- ISBN, DOI, DOI do Capítulo
- Campos extras conforme configuração

---

## 4. CONFIGURAÇÕES

Central administrativa com 6 abas.

### Aba: Chaves (Credenciais)
Salva chaves de acesso a serviços externos:
- **WordPress**: URL do site, usuário, senha de app
- **Crossref/DOI**: Login ID, senha
- **VPS**: Senha do servidor
- **IA**: Groq API Key, OpenRouter API Key, Gemini API Key
- **Tawk.to**: Property ID e Widget ID (chat ao vivo)
- **SMTP/AWS SES**: Host, porta, usuário, senha, remetente
- **Google OAuth**: Client ID e Client Secret

Clique em "Salvar Chaves" para gravar tudo.
Todas as senhas têm botão de olho para mostrar/ocultar.

### Aba: Metadados (FormLayoutBuilder)
Configura os campos de cada tipo de registro:
- Adicionar/remover campos
- Definir tipo, nome, obrigatoriedade
- Reordenar via drag-and-drop
- **Campos do Sistema** (box separado, abaixo do Banco de Campos):
  - Não podem ser apagados nem renomeados, apenas editados
  - Incluem: Taxa de Publicação, Status da Avaliação, Status do Pagamento, Status do Termo de Cessão, Status da Publicação, ISBN, DOI, DOI do Capítulo
  - As opções configuradas aqui alimentam os campos correspondentes nos formulários de Artigos

### Aba: Mensagens
- **URL do Webhook n8n**: endpoint de automação
- **Templates de mensagem**: editor de email com variáveis dinâmicas
- **Templates do Sistema**: Redefinição de Senha, Boas-vindas, OTP, Confirmação de Submissão, Notificação de Nova Submissão

### Aba: Backup
- Download de backup completo do banco de dados
- Upload de arquivo de restore

### Aba: Usuários
- Criar, editar e deletar usuários
- Definir email, nome, senha e role

### Aba: Permissões
- Controle de acesso por role
- Roles disponíveis: superadmin, admin, organizador, autor, user
- Admin e superadmin veem tudo
- Organizador vê apenas o que tem permissão habilitada
- Autor vê apenas seus próprios registros

---

## 5. POST STUDIO (Redes Sociais)

Cria e publica posts para redes sociais.

### Como usar:
1. Selecione uma mídia da galeria (imagem ou vídeo)
2. Escolha as redes de destino (chips clicáveis):
   - Instagram Feed (4:5)
   - Instagram Stories (9:16)
   - Facebook Feed
   - Facebook Stories
   - WhatsApp Status
3. Escreva a legenda ou use a IA para gerar
4. Clique em "Publicar"

### Galeria de mídia:
- Abas: Imagens | Vídeos
- Upload de múltiplos arquivos de uma vez
- Deletar arquivo com confirmação

### IA para legendas:
- Digite um prompt descrevendo o post
- Ative "Vision" para a IA analisar a imagem
- Clique em "Gerar"
- Use "Aceitar" para inserir na legenda

### Histórico:
- Lista de posts enviados com data/hora e redes

### Observação técnica:
O Post Studio envia para o n8n (https://n8.poisson.com.br) que executa a publicação nas redes. Se o n8n estiver com credenciais expiradas, as postagens chegam no n8n mas não são publicadas.

---

## 6. CANVA DE POBRE (Editor Visual)

Editor de design tipo Canva para criar artes, mockups e posts.

### Como criar uma arte:
1. Acesse o Canva de Pobre no menu Apps
2. Clique em "+" para criar novo mockup
3. Escolha o formato: Feed Vertical (4:5), Stories (9:16), Quadrado (1:1), A4 Retrato, A4 Paisagem
4. Adicione elementos ao canvas:
   - **Texto**: fontes Google e sistema, tamanho, cor, bold/italic
   - **Imagem**: upload, busca stock, biblioteca do usuário
   - **Formas**: retângulo, círculo, quadrado, polígono
   - **Elementos**: selos, bordas, ornamentos, fitas (biblioteca de elementos)
5. Clique em qualquer elemento para editar posição, tamanho, rotação, opacidade
6. Use "Salvar" para gravar o template
7. Use "Download" para exportar como PNG/JPG

### Recursos avançados:
- **Múltiplas páginas**: adicione e navegue entre páginas
- **Duplicar para outro formato**: replica o design em outro tamanho com elementos reposicionados
- **Organização em pastas**: templates ficam em pastas (Para Livros, Certificados, etc.)
- **Renomear/Duplicar/Deletar** templates na lista

### Edição de elemento:
- Arrastar para mover
- Handles de canto para redimensionar
- Propriedades no painel direito: X, Y, Width, Height, Rotação, Opacidade, Z-index

---

## 7. PADARIA (Formatador Automático)

Formata documentos Word seguindo o padrão editorial Poisson.

### Como usar:
1. Acesse "Padaria" no menu (ícone de trigo)
2. Escolha um dos 16 modelos de capa clicando na miniatura
3. (Opcional) Passe o mouse sobre o modelo e clique em "Edit" para personalizar cores:
   - Cor das seções, Capítulo X, Título do Artigo, Autores, Resumo, Cabeçalho/Rodapé
4. (Opcional) Salve o tema clicando em "Salvar"
5. (Opcional) Ative/desative recuo de 1,25cm
6. Faça upload do documento Word (.docx)
7. Clique em "Formatar"
8. Aguarde o processamento (logs aparecem em tempo real)
9. Clique em "Baixar" para obter o documento formatado

---

## 8. PAINEL DO AUTOR

Acesso restrito para autores externos. O autor vê apenas suas próprias submissões.

### Funcionalidades:
- Submeter novo artigo (DOCX ou PDF)
- Acompanhar status da submissão
- Receber notificações
- Download de documentos relacionados

---

## 9. CHAMADAS ABERTAS

Gerencia os "call for papers" e convites para submissão.

### Funcionalidades:
- Lista de chamadas ativas
- Sincronização com WordPress (atualiza dropdown no site)
- Edição de prazos, taxas e capas via API REST do WordPress

---

## 10. ERROS E SOLUÇÕES

**"Failed to fetch" ou "Erro ao conectar"**
→ O backend pode estar fora do ar. Aguarde e tente novamente. Se persistir, contate o suporte.

**Tela branca ao abrir**
→ Limpe o cache do navegador (apenas Cache, não senhas). Em Firefox: Ctrl+Shift+Del → marque só Cache → período "Tudo".

**"Não autorizado" ou cai no login**
→ Sessão expirada. Faça logout e login novamente.

**"Falha no upload"**
→ Arquivo pode ser maior que 100MB. Compacte ou divida o arquivo.

**IA não responde / "Nenhum provedor disponível"**
→ Chaves de API não configuradas ou inválidas. Vá em Configurações → Chaves, confirme as chaves de Groq, Gemini ou OpenRouter e clique em "Salvar Chaves".

**Post Studio não publica**
→ O n8n pode estar com credenciais de redes sociais expiradas. Acesse n8.poisson.com.br e verifique os workflows.

**"ID Inválido" em campos select**
→ Clique em "Recarregar Metadados" na barra de título.

**Campos do formulário não aparecem**
→ A configuração de metadados pode estar incompleta. Vá em Configurações → Metadados e verifique os campos cadastrados.

**Crossref retorna erro**
→ Verifique as credenciais em Configurações → Chaves (Login ID padrão: pois).

---

## 11. DICAS DE USO

- Para encontrar um livro rapidamente: use a busca textual no Acervo ou crie um Motor de Busca salvo
- Para ver livros atrasados: olhe os badges vermelhos/amarelos nos cards ou clique em uma etapa do Pipeline
- Para copiar um layout de artigo para outro formato no Canva de Pobre: use "Duplicar para Formato"
- Para enviar comunicado em massa: use os Templates de Mensagem em Configurações → Mensagens
- O token de sessão é salvo no sessionStorage; ao fechar o navegador, será necessário logar novamente
`;

// Busca dados relevantes no banco baseado na pergunta do usuário
async function queryDatabaseContext(question) {
    const results = [];

    try {
        // Detecta se pergunta é sobre dados específicos
        const isAboutData = /autor|livro|artigo|coletân|publicaç|isbn|doi|título|titulo|quem|quantos|lista|encontr|busca|pesquisa|existe|tem algum|há algum/i.test(question);
        if (!isAboutData) return '';

        // Extrai termos de busca relevantes (remove stopwords)
        const stopwords = /^(o|a|os|as|de|da|do|das|dos|em|no|na|nos|nas|que|qual|quais|como|onde|quando|é|para|por|com|um|uma|uns|umas|me|meu|minha|sobre|algum|alguma|tem|há|existe|isso|este|esta|esse|essa)$/i;
        const terms = question
            .replace(/[?!.,;:]/g, '')
            .split(/\s+/)
            .filter(t => t.length > 2 && !stopwords.test(t));

        if (terms.length === 0) return '';

        const searchPattern = terms.join(' & ');

        // Busca em livros/coletâneas (records com id I- ou C-)
        const livros = await pool.query(`
            SELECT id,
                   data->>'titulo' as titulo,
                   data->>'status' as status,
                   data->>'doi' as doi,
                   data->>'ano' as ano,
                   data->>'tipo' as tipo,
                   data->'autores' as autores
            FROM records
            WHERE (id LIKE 'I-%' OR id LIKE 'C-%')
              AND (
                  to_tsvector('portuguese', COALESCE(data->>'titulo','') || ' ' || COALESCE(data->>'autores_texto',''))
                  @@ to_tsquery('portuguese', $1)
                  OR data::text ILIKE ANY(ARRAY[${terms.map((_, i) => `$${i+2}`).join(',')}])
              )
            LIMIT 5
        `, [searchPattern, ...terms.map(t => `%${t}%`)]);

        if (livros.rows.length > 0) {
            results.push('=== LIVROS/COLETÂNEAS ENCONTRADOS ===');
            livros.rows.forEach(r => {
                let autores = '';
                try {
                    const arr = typeof r.autores === 'string' ? JSON.parse(r.autores) : r.autores;
                    if (Array.isArray(arr)) autores = arr.map(a => a.nome || a.name || a).filter(Boolean).join(', ');
                } catch(e) {}
                results.push(`ID: ${r.id} | Título: ${r.titulo || '(sem título)'} | Status: ${r.status || '-'} | Ano: ${r.ano || '-'} | DOI: ${r.doi || '-'}${autores ? ' | Autores: ' + autores : ''}`);
            });
        }

        // Busca em artigos (records com id A-)
        const artigos = await pool.query(`
            SELECT id,
                   data->>'titulo' as titulo,
                   data->>'titulo_artigo' as titulo_artigo,
                   data->>'status_publicacao' as status,
                   data->'nomes' as autores,
                   data->>'livro' as livro
            FROM records
            WHERE id LIKE 'A-%'
              AND data::text ILIKE ANY(ARRAY[${terms.map((_, i) => `$${i+1}`).join(',')}])
            LIMIT 5
        `, terms.map(t => `%${t}%`));

        if (artigos.rows.length > 0) {
            results.push('=== ARTIGOS ENCONTRADOS ===');
            artigos.rows.forEach(r => {
                const titulo = r.titulo_artigo || r.titulo || '(sem título)';
                let autores = '';
                try {
                    const arr = typeof r.autores === 'string' ? JSON.parse(r.autores) : r.autores;
                    if (Array.isArray(arr)) autores = arr.join(', ');
                } catch(e) {}
                results.push(`ID: ${r.id} | Título: ${titulo} | Status: ${r.status || '-'} | Livro: ${r.livro || '-'}${autores ? ' | Autores: ' + autores : ''}`);
            });
        }

        // Se pergunta sobre contagens
        if (/quantos|total|quantidade/i.test(question)) {
            const counts = await pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE id LIKE 'I-%') as individuais,
                    COUNT(*) FILTER (WHERE id LIKE 'C-%') as coletaneas,
                    COUNT(*) FILTER (WHERE id LIKE 'A-%') as artigos
                FROM records
            `);
            const c = counts.rows[0];
            results.push(`=== TOTAIS NO BANCO ===\nLivros individuais: ${c.individuais} | Coletâneas: ${c.coletaneas} | Artigos: ${c.artigos}`);
        }

    } catch(e) {
        console.error('[Help RAG]', e.message);
    }

    return results.join('\n');
}

router.post('/help', async (req, res) => {
    const { messages, apiKeys, currentView } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Messaging is required.' });
    }

    const isValidKey = (k) => typeof k === 'string' && k.length > 20 && !k.includes(':');

    let groqKey = await getApiKeyFromSettings('groq_api_key');
    if (!isValidKey(groqKey)) groqKey = await getApiKeyFromSettings('groq_key');
    if (!isValidKey(groqKey)) groqKey = apiKeys?.groq || null;

    let geminiKey = await getApiKeyFromSettings('gemini_api_key');
    if (!isValidKey(geminiKey)) geminiKey = await getApiKeyFromSettings('gemini_key');
    if (!isValidKey(geminiKey)) geminiKey = apiKeys?.gemini || null;

    let openRouterKey = await getApiKeyFromSettings('openrouter_api_key');
    if (!isValidKey(openRouterKey)) openRouterKey = await getApiKeyFromSettings('openrouter_key');
    if (!isValidKey(openRouterKey)) openRouterKey = apiKeys?.openrouter || null;

    // Busca dados do banco relevantes à última pergunta do usuário
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const dbContext = await queryDatabaseContext(lastUserMsg);
    const dbSection = dbContext ? `\n\n---\n## DADOS DO BANCO (consulta em tempo real)\n${dbContext}\n---` : '';

    // System prompt completo (para modelos de grande contexto)
    const systemFull = `Você é o Assistente de Help do Poisson ERP. Responda em português, de forma curta e direta.
Use o manual abaixo para ajudar com navegação no sistema. Se houver dados do banco, use-os para responder perguntas sobre livros, artigos e autores.
O usuário está na visualização: "${currentView || 'Desconhecida'}".

${SYSTEM_HELP_MANUAL}${dbSection}`;

    // System prompt compacto (para modelos com contexto menor — máx ~3000 tokens)
    const systemCompact = `Você é o assistente do Poisson ERP. Responda em português, curto e direto.
Visualização atual: "${currentView || 'Desconhecida'}".
${SYSTEM_HELP_MANUAL.substring(0, 8000)}${dbSection}`;

    const chatFull = [{ role: 'system', content: systemFull }, ...messages];
    const chatCompact = [{ role: 'system', content: systemCompact }, ...messages];

    const errors = [];

    try {
        // 1. Gemini 2.0 Flash via v1beta (1M tokens de contexto, gratuito)
        if (geminiKey) {
            try {
                const geminiOptions = {
                    hostname: 'generativelanguage.googleapis.com',
                    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
                    method: 'POST',
                    headers: {}
                };
                const geminiBody = {
                    contents: messages.map(m => ({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: m.content }]
                    })),
                    systemInstruction: { parts: [{ text: systemFull }] },
                    generationConfig: { maxOutputTokens: 600, temperature: 0.7 }
                };
                const { status, json } = await makeRequest(geminiOptions, geminiBody);
                if (status >= 200 && status < 300 && json.candidates?.[0]?.content?.parts?.[0]?.text) {
                    return res.json({ text: json.candidates[0].content.parts[0].text, provider: 'gemini' });
                }
                errors.push('Gemini:' + status + ':' + JSON.stringify(json.error || json).substring(0, 120));
            } catch(e) { errors.push('Gemini:exc:' + e.message); }
        } else { errors.push('Gemini:sem-chave'); }

        // 2. OpenRouter — google/gemini-2.0-flash-exp:free (grande contexto, free)
        if (openRouterKey) {
            try {
                const orOptions = {
                    hostname: 'openrouter.ai',
                    path: '/api/v1/chat/completions',
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${openRouterKey}`,
                        'HTTP-Referer': 'https://poisson.com.br',
                        'X-Title': 'Poisson ERP'
                    }
                };
                const orBody = {
                    model: 'google/gemini-2.0-flash-exp:free',
                    messages: chatFull,
                    max_tokens: 600,
                    temperature: 0.7
                };
                const { status, json } = await makeRequest(orOptions, orBody);
                if (status >= 200 && status < 300 && json.choices?.[0]?.message?.content) {
                    return res.json({ text: json.choices[0].message.content, provider: 'openrouter' });
                }
                errors.push('OpenRouter:' + status + ':' + JSON.stringify(json.error || json).substring(0, 120));
            } catch(e) { errors.push('OpenRouter:exc:' + e.message); }
        } else { errors.push('OpenRouter:sem-chave'); }

        // 3. Groq — llama-3.3-70b-versatile com prompt compacto
        if (groqKey) {
            try {
                const groqOptions = {
                    hostname: 'api.groq.com',
                    path: '/openai/v1/chat/completions',
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}` }
                };
                const groqBody = {
                    model: 'llama-3.3-70b-versatile',
                    messages: chatCompact,
                    max_tokens: 500,
                    temperature: 0.7
                };
                const { status, json } = await makeRequest(groqOptions, groqBody);
                if (status >= 200 && status < 300 && json.choices?.[0]?.message?.content) {
                    return res.json({ text: json.choices[0].message.content, provider: 'groq' });
                }
                errors.push('Groq:' + status + ':' + JSON.stringify(json.error || json).substring(0, 120));
            } catch(e) { errors.push('Groq:exc:' + e.message); }
        } else { errors.push('Groq:sem-chave'); }

        console.log('[Help] Todos falharam:', errors);
        res.status(500).json({ error: 'Nenhum provedor disponível. Detalhes: ' + errors.join(' | ') });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

