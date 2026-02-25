const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const FormData = require('form-data');

/**
 * POST /api/wordpress/publish
 * Publica um livro como produto WooCommerce.
 */
router.post('/publish', async (req, res) => {
    const {
        wpUrl, wpUser, wpAppPassword, title, isbn, doi, description, abstract,
        area, lerOnline, dataPublicacao, autores, anoAtual, citationPdfUrl,
        coverBase64, coverMime, coverFilename,
        productId  // se existir → atualiza; se não → cria
    } = req.body;

    if (!wpUrl || !wpUser || !wpAppPassword || !title) {
        return res.status(400).json({ message: 'wpUrl, wpUser, wpAppPassword e title são obrigatórios.' });
    }

    const base = wpUrl.replace(/\/$/, '');
    const authHeader = 'Basic ' + Buffer.from(`${wpUser}:${wpAppPassword}`).toString('base64');

    try {
        // ── 1. Upload da capa para a Biblioteca de Mídia ──────────────────────
        let mediaId = null;
        let coverWarning = null;

        if (coverBase64) {
            const mimeType = 'image/jpeg'; // Canvas sempre exporta em JPEG
            const filename = 'capa.jpg';
            const imgBuffer = Buffer.from(coverBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');

            console.log(`[wordpress] Enviando capa: ${Math.round(imgBuffer.length / 1024)} KB`);

            const form = new FormData();
            form.append('file', imgBuffer, { filename, contentType: mimeType });

            const mediaRes = await fetch(`${base}/wp-json/wp/v2/media`, {
                method: 'POST',
                headers: {
                    Authorization: authHeader,
                    'Content-Disposition': `attachment; filename="${filename}"`,
                    ...form.getHeaders(),
                },
                body: form,
            });

            if (mediaRes.ok) {
                const mediaData = await mediaRes.json();
                mediaId = mediaData.id;
                console.log(`[wordpress] Capa enviada com sucesso. mediaId=${mediaId}`);
            } else {
                const errText = await mediaRes.text();
                coverWarning = `Upload da capa falhou (${mediaRes.status}): ${errText.substring(0, 200)}`;
                console.warn('[wordpress] Falha no upload da capa:', errText);
                // Continua sem capa – o produto será criado mesmo assim
            }
        }

        // ── 2. Criar produto WooCommerce ──────────────────────────────────────
        const productPayload = {
            name: title,
            status: 'publish',
            description: description || '',
            type: 'simple',
            meta_data: [
                { key: 'citation_journal_title', value: 'Editora Poisson' },
                { key: 'citation_title', value: title || '' },
                { key: 'citation_author', value: autores || '' },
                { key: 'citation_abstract', value: abstract || '' },
                { key: 'citation_doi', value: doi || '' },
                { key: 'citation_isbn', value: isbn || '' },
                { key: 'citation_date', value: anoAtual || '' },
                { key: 'citation_pdf_url', value: citationPdfUrl || '' },
                { key: 'area-do-conhecimento', value: area || '' },
                { key: 'ler-online', value: lerOnline || '' },
                { key: 'data', value: dataPublicacao || '' },
            ],
        };

        if (mediaId) {
            productPayload.images = [{ id: mediaId }];
        }

        const method = productId ? 'PUT' : 'POST';
        const productsUrl = productId
            ? `${base}/wp-json/wc/v3/products/${productId}`
            : `${base}/wp-json/wc/v3/products`;

        console.log(`[wordpress] ${method} produto${productId ? ` ID ${productId}` : ' (novo)'}`);
        console.log('[wordpress] Produto payload:', JSON.stringify(productPayload, null, 2));

        const productRes = await fetch(productsUrl, {
            method,
            headers: {
                Authorization: authHeader,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(productPayload),
        });

        let productData;
        try {
            productData = await productRes.json();
        } catch (e) {
            const raw = await productRes.text().catch(() => '(sem corpo)');
            return res.status(502).json({ message: `Resposta inválida do WordPress (${productRes.status}): ${raw.substring(0, 300)}` });
        }

        console.log('[wordpress] Resposta WooCommerce status:', productRes.status);
        console.log('[wordpress] meta_data retornado:', JSON.stringify(productData.meta_data, null, 2));

        if (productRes.ok) {
            return res.json({
                ok: true,
                productId: productData.id,
                productUrl: productData.permalink,
                adminUrl: `${base}/wp-admin/post.php?post=${productData.id}&action=edit`,
                coverWarning,
                metaReturned: productData.meta_data || [],
            });
        } else {
            const errMsg = productData.message || productData.error || JSON.stringify(productData);
            return res.status(productRes.status).json({
                message: errMsg,
                code: productData.code || productData.error,
                coverWarning,
            });
        }

    } catch (err) {
        console.error('[wordpress/publish] Erro:', err);
        return res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

/**
 * POST /api/wordpress/set-status
 * Altera o status de um produto WooCommerce (publish ↔ draft).
 */
router.post('/set-status', async (req, res) => {
    const { wpUrl, wpUser, wpAppPassword, productId, status } = req.body;

    if (!wpUrl || !wpUser || !wpAppPassword || !productId || !status) {
        return res.status(400).json({ message: 'Parâmetros obrigatórios: wpUrl, wpUser, wpAppPassword, productId, status.' });
    }
    if (!['publish', 'draft'].includes(status)) {
        return res.status(400).json({ message: 'Status inválido. Use "publish" ou "draft".' });
    }

    const base = wpUrl.replace(/\/$/, '');
    const authHeader = 'Basic ' + Buffer.from(`${wpUser}:${wpAppPassword}`).toString('base64');

    try {
        const r = await fetch(`${base}/wp-json/wc/v3/products/${productId}`, {
            method: 'PUT',
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        const data = await r.json();
        if (r.ok) {
            return res.json({ ok: true, status: data.status });
        }
        return res.status(r.status).json({ message: data.message || JSON.stringify(data) });
    } catch (err) {
        return res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

module.exports = router;

