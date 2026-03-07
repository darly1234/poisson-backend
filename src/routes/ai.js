const express = require('express');
const https = require('https');
const router = express.Router();

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

function geminiRequest(apiKey, model, prompt) {
    const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1/models/${model}:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {}
    };
    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 700, temperature: 0.8 }
    };
    return makeRequest(options, body);
}

router.post('/generate-caption', async (req, res) => {
    // legacy apiKey suportado para fallback, mas preferimos apiKeys={gemini, groq, openrouter}
    const { apiKey, apiKeys, prompt } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'O prompt é obrigatório.' });
    }

    const keys = apiKeys || { gemini: apiKey };
    const { gemini, groq, openrouter } = keys;

    if (!gemini && !groq && !openrouter) {
        return res.status(400).json({ error: 'Nenhuma chave de API fornecida.' });
    }

    let lastError = null;

    // 1. Tentar Groq
    if (groq) {
        try {
            const { status, json } = await groqRequest(groq, prompt);
            if (status >= 200 && status < 300 && json.choices?.[0]?.message?.content) {
                return res.json({ text: json.choices[0].message.content, model: 'groq/llama3-70b-8192' });
            }
            lastError = `Groq devolveu status ${status}: ${JSON.stringify(json.error || json)}`;
            console.error("[AI Groq Error]", status, json);
        } catch (err) {
            lastError = `Erro na Groq: ${err.message}`;
            console.error("[AI Groq Exception]", err.message);
        }
    }

    // 2. Tentar OpenRouter
    if (openrouter) {
        try {
            const { status, json } = await openRouterRequest(openrouter, prompt);
            if (status >= 200 && status < 300 && json.choices?.[0]?.message?.content) {
                return res.json({ text: json.choices[0].message.content, model: 'openrouter/gemini-2.0-flash-lite-free' });
            }
            lastError = `OpenRouter devolveu status ${status}: ${JSON.stringify(json.error || json)}`;
            console.error("[AI OpenRouter Error]", status, json);
        } catch (err) {
            lastError = `Erro no OpenRouter: ${err.message}`;
            console.error("[AI OpenRouter Exception]", err.message);
        }
    }

    // 3. Tentar Gemini original iterando pelos modelos
    if (gemini) {
        const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
        for (const model of models) {
            try {
                const { status, json } = await geminiRequest(gemini, model, prompt);
                if (status >= 200 && status < 300 && json.candidates?.[0]?.content?.parts?.[0]?.text) {
                    return res.json({ text: json.candidates[0].content.parts[0].text, model: `gemini/${model}` });
                }
                const errMsg = json.error?.message || `HTTP ${status}`;
                lastError = `Gemini (${model}): ${errMsg}`;

                const lowerErr = errMsg.toLowerCase();
                if (
                    status === 429 ||
                    status >= 500 ||
                    lowerErr.includes('not found') ||
                    lowerErr.includes('not supported') ||
                    lowerErr.includes('quota') ||
                    lowerErr.includes('exceeded')
                ) {
                    continue; // tenta proximo modelo do gemini
                }
                break; // se for erro de auth, etc, não adianta iterar
            } catch (err) {
                lastError = `Erro no Gemini (${model}): ${err.message}`;
            }
        }
    }

    return res.status(500).json({ error: `Nenhum provedor de Inteligência Artificial conseguiu responder. Último erro reportado: ${lastError}` });
});

module.exports = router;
