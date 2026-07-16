// Consente mutazioni solo da loopback (controllo bot locale / VPS admin).
// La dashboard pubblica è sola lettura: nessun comando dall'esterno.
//
// Dietro nginx: usare X-Real-IP impostato dal proxy (non X-Forwarded-For
// controllabile dal client). Se la richiesta arriva da un proxy locale e
// manca X-Real-IP, la trattiamo come remota (fail-closed).

function clientIp(req) {
  // 1) X-Real-IP — nginx lo imposta a $remote_addr (non spoofabile dal client)
  const real = req.headers['x-real-ip'];
  if (real && typeof real === 'string' && real.trim()) {
    return real.split(',')[0].trim();
  }

  // 2) Socket peer
  const peer = req.socket?.remoteAddress || req.ip || '';
  const peerNorm = String(peer).replace(/^::ffff:/, '');

  // 3) Se peer è loopback e c'è X-Forwarded-For, NON fidarsi del solo XFF
  //    se non abbiamo X-Real-IP: fail-closed → non-local (a meno che non
  //    ci sia esplicitamente un solo hop e TRUST_PROXY_HOPS).
  //    Con trust proxy Express, req.ip può già essere derivato — usalo solo
  //    se peer non è loopback.
  if (!isLoopbackIp(peerNorm)) {
    return peerNorm;
  }

  // Peer is loopback (nginx → node). Without X-Real-IP we must not treat as local.
  // Optional: allow true local clients that hit node directly without proxy headers.
  const hasProxyHints =
    req.headers['x-forwarded-for']
    || req.headers['x-forwarded-proto']
    || req.headers['x-forwarded-host'];
  if (hasProxyHints) {
    // Proxied request missing X-Real-IP → fail closed
    const xf = req.headers['x-forwarded-for'];
    if (xf && typeof xf === 'string') {
      // last hop is usually the real client when nginx overwrites; still prefer fail-closed
      // only accept if ALLOW_XFF_FALLBACK=1
      if (process.env.ALLOW_XFF_FALLBACK === '1') {
        return xf.split(',')[0].trim();
      }
    }
    return '0.0.0.0'; // non-local sentinel
  }

  // Direct connection to node from localhost (SSH admin, systemd health, curl)
  return peerNorm;
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
