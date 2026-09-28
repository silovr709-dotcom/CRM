// Небольшие меры безопасности для продакшена — без внешних зависимостей.

// ---------- Заголовки безопасности ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(self), microphone=(self)');
  if (process.env.DISABLE_CSP !== '1') res.setHeader('Content-Security-Policy', CSP);
  // HSTS имеет смысл только когда сайт реально открыт по https
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

// ---------- Ограничение попыток входа (защита от перебора пароля) ----------
const attempts = new Map(); // ip -> { count, first, blockedUntil }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const BLOCK_MS = 15 * 60 * 1000;

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}

export function loginRateLimit(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec?.blockedUntil && rec.blockedUntil > now) {
    const min = Math.ceil((rec.blockedUntil - now) / 60000);
    return res.status(429).json({ error: `Слишком много попыток входа. Попробуйте через ${min} мин.` });
  }
  req.onLoginFailed = () => {
    const cur = attempts.get(ip);
    if (!cur || now - cur.first > WINDOW_MS) {
      attempts.set(ip, { count: 1, first: now, blockedUntil: 0 });
      return;
    }
    cur.count += 1;
    if (cur.count >= MAX_ATTEMPTS) cur.blockedUntil = now + BLOCK_MS;
  };
  req.onLoginOk = () => attempts.delete(ip);
  next();
}

// Чистим накопленное раз в час, чтобы карта не росла бесконечно
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) {
    if (now - rec.first > WINDOW_MS && (!rec.blockedUntil || rec.blockedUntil < now)) attempts.delete(ip);
  }
}, 60 * 60 * 1000).unref?.();
