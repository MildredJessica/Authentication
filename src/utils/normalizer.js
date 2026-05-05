import { createHash } from 'crypto'

// ── Valid value sets ──────────────────────────────────────────────────────────

const VALID_GENDERS    = new Set(['male', 'female'])
const VALID_AGE_GROUPS = new Set(['child', 'teenager', 'adult', 'senior'])
const VALID_SORT_BY    = new Set(['name', 'age', 'gender', 'country_id', 'gender_probability', 'country_probability', 'created_at'])
const VALID_ORDERS     = new Set(['asc', 'desc'])

// ── Canonical filter normalizer ───────────────────────────────────────────────
//
// Takes a raw filter object (from query params or NLP parser) and returns a
// canonical form with:
//   - all keys present (undefined for unset filters)
//   - values normalised to consistent types and cases
//   - keys in alphabetical order (so JSON.stringify is deterministic)
//
// Two queries expressing the same intent always produce the same canonical form,
// and therefore the same cache key.

export function normalizeFilters(raw = {}) {
  const f = {}

  // gender — lowercase, validated
  const gender = raw.gender?.toString().toLowerCase().trim()
  f.gender = VALID_GENDERS.has(gender) ? gender : undefined

  // age_group — lowercase, validated
  const ageGroup = raw.age_group?.toString().toLowerCase().trim()
  f.age_group = VALID_AGE_GROUPS.has(ageGroup) ? ageGroup : undefined

  // country_id — always uppercase ISO code
  const countryId = raw.country_id?.toString().toUpperCase().trim()
  f.country_id = countryId?.length === 2 ? countryId : undefined

  // age range — integers, min must be <= max when both present
  const minAge = raw.min_age !== undefined ? parseInt(raw.min_age, 10) : undefined
  const maxAge = raw.max_age !== undefined ? parseInt(raw.max_age, 10) : undefined

  f.min_age = Number.isFinite(minAge) && minAge >= 0 ? minAge : undefined
  f.max_age = Number.isFinite(maxAge) && maxAge >= 0 ? maxAge : undefined

  // If min > max, swap them — same intent expressed backwards
  if (f.min_age !== undefined && f.max_age !== undefined && f.min_age > f.max_age) {
    ;[f.min_age, f.max_age] = [f.max_age, f.min_age]
  }

  // name search — lowercase trimmed (for contains query)
  const name = raw.name?.toString().toLowerCase().trim()
  f.name = name || undefined

  // sort_by — validated against allowlist
  const sortBy = raw.sort_by?.toString().toLowerCase().trim()
  f.sort_by = VALID_SORT_BY.has(sortBy) ? sortBy : 'created_at'

  // order — validated
  const order = raw.order?.toString().toLowerCase().trim()
  f.order = VALID_ORDERS.has(order) ? order : 'desc'

  // pagination — positive integers
  const page  = parseInt(raw.page, 10)
  const limit = parseInt(raw.limit, 10)
  f.page  = Number.isFinite(page)  && page  >= 1   ? page  : 1
  f.limit = Number.isFinite(limit) && limit >= 1   ? Math.min(limit, 100) : 10

  return f
}

// ── Cache key generator ───────────────────────────────────────────────────────
//
// Produces a short, deterministic cache key from a normalised filter object.
// Uses sorted JSON serialisation so key order doesn't affect the output.
//
// Example: "profiles:a3f9c2e1"

export function buildCacheKey(prefix, normalised) {
  // Remove undefined values before serialising — they don't affect the query
  const clean = Object.fromEntries(
    Object.entries(normalised).filter(([, v]) => v !== undefined)
  )
  // Keys sorted so { gender:'male', country_id:'NG' } === { country_id:'NG', gender:'male' }
  const sorted = Object.keys(clean).sort().reduce((acc, k) => {
    acc[k] = clean[k]
    return acc
  }, {})
  const hash = createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 8)
  return `${prefix}:${hash}`
}

// ── NLP normalizer ────────────────────────────────────────────────────────────
//
// Converts a natural language string into a raw filter object,
// then passes it through normalizeFilters for canonical form.

const COUNTRY_MAP = {
  nigeria: 'NG',    nigerian: 'NG',    nigerians: 'NG',
  ghana: 'GH',      ghanaian: 'GH',    ghanaians: 'GH',
  kenya: 'KE',      kenyan: 'KE',      kenyans: 'KE',
  'south africa': 'ZA', 'south african': 'ZA',
  'united states': 'US', american: 'US', americans: 'US', usa: 'US', 'u.s.a': 'US',
  'united kingdom': 'GB', british: 'GB', uk: 'GB', 'u.k': 'GB',
  france: 'FR',     french: 'FR',
  germany: 'DE',    german: 'DE',
  india: 'IN',      indian: 'IN',
  canada: 'CA',     canadian: 'CA',
  benin: 'BJ',      senegal: 'SN',     senegalese: 'SN',
  cameroon: 'CM',   cameroonian: 'CM',
  tanzania: 'TZ',   tanzanian: 'TZ',
  uganda: 'UG',     ugandan: 'UG',
  ethiopia: 'ET',   ethiopian: 'ET',
  egypt: 'EG',      egyptian: 'EG',
  brazil: 'BR',     brazilian: 'BR',
  australia: 'AU',  australian: 'AU',
}

export function parseNaturalLanguage(query) {
  const q = query.toLowerCase().trim()
  const raw = {}

  // Gender
  if (/\bfemales?\b|\bwomen\b|\bwoman\b|\bgirls?\b|\bladies\b|\blady\b/.test(q)) {
    raw.gender = 'female'
  } else if (/\bmales?\b|\bmen\b|\bman\b|\bguys?\b|\bgentlemen\b/.test(q)) {
    raw.gender = 'male'
  }

  // Explicit age range — "aged 20-45", "between 20 and 45", "ages 20 to 45"
  const rangeMatch = q.match(/(?:aged?|between|ages?)\s+(\d+)\s*(?:[-–—]|to|and)\s*(\d+)/)
  if (rangeMatch) {
    raw.min_age = rangeMatch[1]
    raw.max_age = rangeMatch[2]
  } else {
    // Age groups — only if no explicit range
    if (/\bteen(?:ager)?s?\b|\bjuniors?\b|\byoung\b/.test(q)) raw.age_group = 'teenager'
    else if (/\bchildren?\b|\bkids?\b/.test(q))                 raw.age_group = 'child'
    else if (/\bseniors?\b|\belderly\b|\bold\s+people\b/.test(q)) raw.age_group = 'senior'
    else if (/\badults?\b/.test(q))                              raw.age_group = 'adult'
  }

  // Country — longest match first to catch "south africa" before "africa"
  const sortedCountries = Object.keys(COUNTRY_MAP).sort((a, b) => b.length - a.length)
  for (const keyword of sortedCountries) {
    if (q.includes(keyword)) {
      raw.country_id = COUNTRY_MAP[keyword]
      break
    }
  }

  return normalizeFilters(raw)
}