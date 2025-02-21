// For demonstration purposes, we'll use a static API token
// In production, this should be stored securely (e.g., environment variables)
const VALID_API_TOKENS = new Set([
    'test-token-1',
    'test-token-2'
]);

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN format

    if (!token) {
        return res.status(401).json({ error: 'No authentication token provided' });
    }

    if (!VALID_API_TOKENS.has(token)) {
        return res.status(403).json({ error: 'Invalid authentication token' });
    }

    next();
}

module.exports = {
    authenticateToken,
    VALID_API_TOKENS
};
