// Consente mutazioni solo da loopback (controllo bot locale / VPS admin).
// La dashboard pubblica è sola lettura: nessun comando dall'esterno.

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf && typeof xf === 'string') {
    return xf.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '';
}

function isLoopbackIp(ip) {
  if (!ip) return false;
  const v = String(ip).replace(/^::ffff:/, '');
  return (
    v === '127.0.0.1'
    || v === '::1'
    || v === 'localhost'
    || v === '0:0:0:0:0:0:0:1'
  );
}

/**
 * Middleware: blocca richieste non-locali su route di controllo.
 * Override: ALLOW_REMOTE_CONTROL=1 (sconsigliato).
 */
function localOnly(req, res, next) {
  if (process.env.ALLOW_REMOTE_CONTROL === '1') return next();
  const ip = clientIp(req);
  if (isLoopbackIp(ip)) return next();
  return res.status(403).json({
    ok: false,
    error: 'Forbidden: controllo bot solo da localhost. La dashboard pubblica è sola lettura.',
    readOnly: true,
  });
}

module.exports = { localOnly, isLoopbackIp, clientIp };
