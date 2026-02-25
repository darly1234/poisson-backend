const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'poisson-jwt-secret-change-in-production';

function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Não autorizado.' });
    }
    try {
        const payload = jwt.verify(auth.split(' ')[1], JWT_SECRET);
        req.user = payload;
        next();
    } catch {
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
}

module.exports = { requireAuth };
