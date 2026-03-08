const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development_only';

/**
 * Middleware to verify JWT tokens and attach user info to req.user.
 * Usage: router.post('/some-protected-route', verifyToken, controllerFunction);
 */
const verifyToken = (req, res, next) => {
    // Check Authorization header for token (format: 'Bearer <token>')
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Verify the token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Attach the decoded payload (id, identifier, role) to the request object
        req.user = decoded;

        // Continue to the next middleware or route handler
        next();
    } catch (error) {
        console.error('JWT Verification Error:', error.message);
        return res.status(403).json({ error: 'Invalid or expired token.' });
    }
};

/**
 * Optional Helper: Middleware to check if the authenticated user has a specific role.
 * Usage: router.post('/admin-only', verifyToken, requireRole('admin'), controllerFunction);
 */
const requireRole = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== requiredRole) {
            return res.status(403).json({ error: `Access denied. Requires ${requiredRole} role.` });
        }
        next();
    };
};

module.exports = {
    verifyToken,
    requireRole
};
