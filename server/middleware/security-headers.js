// Security headers for public showcase (defense in depth behind nginx)

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Do not set CSP here — nginx sets a TV-compatible CSP for the public vhost.
  // Prevent MIME sniffing on JSON APIs
  if (req.path.startsWith('/api/') || req.path === '/status' || req.path === '/health') {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

/**
 * Reject mutating methods on public surface if they somehow skip localOnly
 * (e.g. misconfigured route order). Control routes still use localOnly.
 */
function publicMethodGuard(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  // Mutating methods must pass localOnly later — but if path is public static, block early
  const p = req.path || '';
  const controlPrefixes = [
    '/chat', '/message', '/pause', '/resume', '/configure',
    '/wallet/', '/proactive/',
  ];
  // Allow through to localOnly for control routes (they return 403 if remote)
  if (controlPrefixes.some((x) => p === x || p.startsWith(x))) return next();
  return res.status(405).json({
    ok: false,
    error: 'Method not allowed on public surface',
    readOnly: true,
  });
}

module.exports = { securityHeaders, publicMethodGuard };
