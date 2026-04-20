const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const ANEXOS_PATH = process.platform === 'win32'
  ? 'C:\\projeto_poisson_erp'
  : '/home/darly/projeto_poisson_erp';

router.get('/pexels/search', async (req, res) => {
    const { query } = req.query;
    // Tenta pegar do .env ou de uma chave padrão para demonstração (substituir por chave real na produção)
    const apiKey = process.env.PEXELS_API_KEY || '563492ad6f91700001000001859f518e38f94627b0eb8f370e0a5c48'; 
    
    if (!query) return res.status(400).json({ error: 'Query is required' });

    try {
        const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=20`, {
            headers: { 'Authorization': apiKey }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('[Pexels Proxy Error]', err);
        res.status(500).json({ error: 'Erro ao buscar no Pexels: ' + err.message });
    }
});

router.post('/remove-bg', async (req, res) => {
    const { image_url } = req.body;
    const apiKey = process.env.REMOVE_BG_API_KEY;
    
    if (!apiKey) {
        return res.status(500).json({ error: 'Chave da API Remove.bg não configurada no servidor (.env).' });
    }

    if (!image_url) return res.status(400).json({ error: 'image_url is required' });

    try {
        const formData = new FormData();
        formData.append('image_url', image_url);
        formData.append('size', 'auto');

        const response = await fetch('https://api.remove.bg/v1.0/removebg', {
            method: 'POST',
            headers: { 'X-Api-Key': apiKey },
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({ message: 'Erro na API Remove.bg' }));
            return res.status(response.status).json(errData);
        }

        const buffer = await response.buffer();
        
        // Salva o resultado em temp_posts para o frontend poder acessar via URL
        const tempDir = path.join(ANEXOS_PATH, 'temp_posts');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        
        const filename = `rmbg_${Date.now()}.png`;
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, buffer);
        fs.chmodSync(filePath, 0o755);

        const baseUrl = process.env.ANEXOS_BASE_URL || 'https://poisson.com.br/api/anexos';
        
        res.json({
            success: true,
            url: `${baseUrl}/temp_posts/${filename}`,
            name: filename
        });
    } catch (err) {
        console.error('[RemoveBG Proxy Error]', err);
        res.status(500).json({ error: 'Erro ao remover fundo: ' + err.message });
    }
});

module.exports = router;
