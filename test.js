import { rateLimit, MemoryStore } from 'express-rate-limit'
import { getRedis } from '../config/redis.js'

const json429 = (_req, res) =>
  res.status(429).json({ status: 'error', message: 'Too many requests, please slow down.' })

function normalizeIp(ip = '') {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

const isDev = process.env.NODE_ENV !== 'production'

// ── Store factory ─────────────────────────────────────────────────────────────
// Use Redis store when Redis is available so rate limits work correctly
// across multiple app server instances. Fall back to MemoryStore if Redis
// is unavailable — limits won't be shared across instances but traffic
// continues unblocked (fail open).

function makeStore(prefix) {
  const redis = getRedis()
  if (redis) {
    // Lazy import to avoid crashing if rate-limit-redis isn't installed
    try {
      const { RedisStore } = require('rate-limit-redis')
      return new RedisStore({ prefix, sendCommand: (...args) => redis.call(...args) })
    } catch {
      // rate-limit-redis not installed — fall through to MemoryStore
    }
  }
  return new MemoryStore()
}

/** Sensitive endpoints: /auth/refresh, /auth/logout */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MemoryStore(),
  keyGenerator: (req) => `auth_${normalizeIp(req.ip)}`,
  handler: json429,
})

/** General: /auth/me, /auth/github, all /api/* */
export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 500 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MemoryStore(),
  keyGenerator: (req) => `general_${req.user?.id ?? normalizeIp(req.ip)}`,
  handler: json429,
})