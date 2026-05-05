import Redis from 'ioredis'

let client = null
let available = false

export function getRedis() {
  if (!client && process.env.REDIS_URL) {
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    })

    client.on('connect', () => { available = true })
    client.on('error', () => { available = false })

    client.connect().catch(() => { available = false })
  }
  return available ? client : null
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

const DEFAULT_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '30')

export async function cacheGet(key) {
  const redis = getRedis()
  if (!redis) return null
  try {
    const val = await redis.get(key)
    return val ? JSON.parse(val) : null
  } catch {
    return null
  }
}

export async function cacheSet(key, value, ttl = DEFAULT_TTL) {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl)
  } catch {
    // Cache write failure is non-fatal — request still succeeds
  }
}

export async function cacheInvalidatePrefix(prefix) {
  const redis = getRedis()
  if (!redis) return
  try {
    // SCAN is non-blocking unlike KEYS — safe on large keyspaces
    let cursor = '0'
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length) await redis.del(...keys)
    } while (cursor !== '0')
  } catch {
    // Invalidation failure is non-fatal
  }
}