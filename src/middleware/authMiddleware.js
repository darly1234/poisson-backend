const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'poisson-jwt-secret-change-in-production';

function requireAuth(req, res, next) {
    const auth = req.headers.authorization || (req.query.token ? `Bearer ${req.query.token}` : null);

    // Log para debug de autenticação na VPS
    if (req.url.includes('wordpress')) {
        console.log(`[AUTH DEBUG] Request to ${req.url}`);
        console.log(`[AUTH DEBUG] Headers:`, JSON.stringify(req.headers));
        console.log(`[AUTH DEBUG] Has Auth Header: ${!!auth}. Start: ${auth?.substring(0, 15)}...`);
    }

    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Não autorizado.' });
    }
    try {
        const payload = jwt.verify(auth.split(' ')[1], JWT_SECRET);
        req.user = payload;
        next();
    } catch (err) {
        console.error('[AUTH DEBUG] Token verification failed:', err.message);
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
}

module.exports = { requireAuth };
