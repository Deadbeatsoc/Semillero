import { SessionAuthError, resolveAuthenticatedUser } from '../services/sessionAuthService.js';

const extractBearerToken = (authorizationHeader) => {
  const headerValue = String(authorizationHeader || '').trim();
  if (!headerValue) {
    return '';
  }

  const [scheme, token] = headerValue.split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return '';
  }
  return token.trim();
};

const requireAuth = async (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const resolved = await resolveAuthenticatedUser(token, { touch: true });
    req.authUser = resolved.user;
    req.authTokenHash = resolved.tokenHash;
    return next();
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return res.status(error.status).json({ message: error.message });
    }
    return res.status(500).json({ message: 'No se pudo validar la sesion.' });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.authUser || req.authUser.role !== 'admin') {
    return res.status(403).json({ message: 'Acceso restringido a administradores.' });
  }
  return next();
};

export { extractBearerToken, requireAdmin, requireAuth };
