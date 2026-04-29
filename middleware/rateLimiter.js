import { rateLimit, MemoryStore } from 'express-rate-limit'

const json429 = (_req, res) =>
  res.status(429).json({ status: 'error', message: 'Too many requests, please slow down.' })

// Normalize IPv6-mapped IPv4 (e.g. ::ffff:1.2.3.4 → 1.2.3.4)
function normalizeIp(ip = '') {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}
const isDev = process.env.NODE_ENV !== 'production'

/** 60 req/min — /auth/me, /auth/github, /auth/github/callback, all /api/* */
export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 500 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MemoryStore(),
  keyGenerator: (req) => `general_${req.user?.id ?? normalizeIp(req.ip)}`,
  handler: json429,
})

/** 10 req/min — sensitive write endpoints only: /auth/refresh, /auth/logout */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MemoryStore(),
  keyGenerator: (req) => `auth_${normalizeIp(req.ip)}`,
  handler: json429,
})
