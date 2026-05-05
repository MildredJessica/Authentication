import { Router } from 'express'
import {stringify} from 'csv-stringify'
import multer from 'multer'
import prisma from '../config/prisma.js'
import { requireRole } from '../middleware/requireAuth.js'
import { fetchProfileData } from '../src/services/profileService.js'
import { buildProfileFilters, buildOrderBy } from '../src/utils/queryBuilder.js'
import { paginationLinks } from '../src/utils/pagination.js'
import { normalizeFilters, buildCacheKey, parseNaturalLanguage } from '../src/utils/normalizer.js'
import { cacheGet, cacheSet, cacheInvalidatePrefix } from '../config/redis.js'
import { ingestCsv } from '../src/services/csvIngestion.js'

export const profileRouter = Router()

// ── Multer — memory storage capped at 50MB ────────────────────────────────────
// We stream the buffer through csv-parse, never writing to disk.
// 50MB covers ~500k rows of profile CSV (avg ~100 bytes/row).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true)
    } else {
      cb(new Error('Only CSV files are accepted'))
    }
  },
})


// ── GET /api/profiles ─────────────────────────────────────────────────────────
profileRouter.get('/profiles', async (req, res, next) => {
  try {
    // 1. Normalize query params into canonical form
    const norm = normalizeFilters(req.query)
    const cacheKey = buildCacheKey('profiles:list', norm)

    // 2. Check cache
    const cached = await cacheGet(cacheKey)
    if (cached) {
      return res.json({ ...cached, _cache: 'HIT' })
    }

    // 3. Build and run query
    const where   = buildProfileFilters(norm)
    const orderBy = buildOrderBy(norm)
    const skip    = (norm.page - 1) * norm.limit

    const [total, data] = await Promise.all([
      prisma.profile.count({ where }),
      prisma.profile.findMany({
        where,
        orderBy,
        skip,
        take: norm.limit,
        // Select only needed columns — reduces row size over the wire
        select: {
          id: true, name: true, gender: true, gender_probability: true,
          age: true, age_group: true, country_id: true, country_name: true,
          country_probability: true, created_at: true,
        },
      }),
    ])

    const total_pages = Math.ceil(total / norm.limit)
    const body = {
      status: 'success',
      page: norm.page,
      limit: norm.limit,
      total,
      total_pages,
      links: paginationLinks(req, norm.page, total_pages, norm.limit),
      data,
    }

    // 4. Store in cache (30s TTL)
    await cacheSet(cacheKey, body)

    res.json(body)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/profiles/search ──────────────────────────────────────────────────
profileRouter.get('/profiles/search', async (req, res, next) => {
  try {
    const { q } = req.query
    if (!q) return res.status(400).json({ status: 'error', message: 'Query parameter q is required' })


    // Normalize: NLP parse → canonical filters → cache key
    // Two different phrasings of the same intent produce the same key    
    const filters = parseNaturalLanguage(q)
    // Apply pagination overrides from query params
    if (req.query.page)  norm.page  = Math.max(1, parseInt(req.query.page) || 1)
    if (req.query.limit) norm.limit = Math.min(100, parseInt(req.query.limit) || 10)

    // 1. Normalize query params into canonical form
    const norm = normalizeFilters(req.query)
    const cacheKey = buildCacheKey('profiles:list', norm)

    // 2. Check cache
    const cached = await cacheGet(cacheKey)
    if (cached) {
      return res.json({ ...cached, _cache: 'HIT' })
    }

    // 3. Build and run query
    const where   = buildProfileFilters(norm)
    const skip    = (norm.page - 1) * norm.limit

    const [total, data] = await Promise.all([
      prisma.profile.count({ where }),
      prisma.profile.findMany({
        where,
        orderBy,
        skip,
        take: norm.limit,
        orderBy: { created_at: 'desc' },
        // Select only needed columns — reduces row size over the wire
        select: {
          id: true, name: true, gender: true, gender_probability: true,
          age: true, age_group: true, country_id: true, country_name: true,
          country_probability: true, created_at: true,
        },
      }),
    ])

    const total_pages = Math.ceil(total / norm.limit)

    res.json({
      status: 'success',
      page: norm.page,
      limit: norm.limit,
      total,
      total_pages,
      links: paginationLinks(req, norm.page, total_pages, norm.limit),
      data,
    })
    await cacheSet(cacheKey, body)
    res.json(body)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/profiles/export ──────────────────────────────────────────────────
// Cursor-based streaming export — never loads all rows into memory.
// Each page of EXPORT_PAGE_SIZE rows is fetched via cursor (last seen id),
// written to the CSV stream, then released from memory.
profileRouter.get('/profiles/export', async (req, res, next) => {
  try {
    const { format = 'csv' } = req.query
    if (format !== 'csv') {
      return res.status(400).json({ status: 'error', message: 'Only format=csv is supported' })
    }

    const norm    = normalizeFilters(req.query)
    const where   = buildProfileFilters(norm)
    const orderBy = buildOrderBy(norm)

    const EXPORT_PAGE_SIZE = 500
    const columns = [
      'id','name','gender','gender_probability','age','age_group',
      'country_id','country_name','country_probability','created_at',
    ]

    const profiles = await prisma.profile.findMany({ where, orderBy })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="profiles_${timestamp}.csv"`)

    const csvStream = stringify({
      header: true,
      columns: {
        id: 'id',
        name: 'name',
        gender: 'gender',
        gender_probability: 'gender_probability',
        age: 'age',
        age_group: 'age_group',
        country_id: 'country_id',
        country_name: 'country_name',
        country_probability: 'country_probability',
        created_at: 'created_at',
      },
    })

    csvStream.pipe(res)
    // Cursor pagination: fetch EXPORT_PAGE_SIZE rows at a time.
    // Uses `cursor: { id: lastId }` which is O(1) regardless of offset depth.
    let lastId = undefined
    
    while (true) {
      const page = await prisma.profile.findMany({
        where,
        orderBy: [{ id: 'asc' }], // cursor pagination requires stable sort on unique field
        take: EXPORT_PAGE_SIZE,
        ...(lastId ? { cursor: { id: lastId }, skip: 1 } : {}),
        select: {
          id: true, name: true, gender: true, gender_probability: true,
          age: true, age_group: true, country_id: true, country_name: true,
          country_probability: true, created_at: true,
        },
      })
    
      if (!page.length) break

      for (const p of page) {
        csvStream.write({
          ...p,
          created_at:
            p.created_at instanceof Date
            ? p.created_at.toISOString()
            : p.created_at,
        })
      }
      lastId = page[page.length - 1].id
      if (page.length < EXPORT_PAGE_SIZE) break
    }

    csvStream.end()
  } catch (err) {
    next(err)
  }
})

// ── GET /api/profiles/:id ─────────────────────────────────────────────────────
// Single profile: route to primary for guaranteed freshness (no replica lag).
// Short cache TTL of 60s — profile data rarely changes.
profileRouter.get('/profiles/:id', async (req, res, next) => {
  try {
    const cacheKey = `profiles:id:${req.params.id}`
    const cached = await cacheGet(cacheKey)
    if (cached) return res.json({ ...cached, _cache: 'HIT' })
    const profile = await prisma.profile.findUnique({ where: { id: req.params.id } })
    if (!profile) return res.status(404).json({ status: 'error', message: 'Profile not found' })
    const body = { status: 'success', data: profile }
    await cacheSet(cacheKey, body, 60)
    res.json(body)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/profiles (admin only) ──────────────────────────────────────────
profileRouter.post('/profiles', requireRole('admin'), async (req, res, next) => {
  try {
    const { name } = req.body
    if (!name?.trim()) {
      return res.status(400).json({ status: 'error', message: 'name is required' })
    }

    const existing = await prisma.profile.findUnique({ where: { name: name.trim() } })
    if (existing) {
      return res.status(409).json({ status: 'error', message: 'Profile with this name already exists' })
    }

    const profileData = await fetchProfileData(name.trim())
    const profile = await prisma.profile.create({ data: profileData })
    // Invalidate list/search cache — new profile changes counts and results
    await cacheInvalidatePrefix('profiles:list')
    await cacheInvalidatePrefix('profiles:search')

    res.status(201).json({ status: 'success', data: profile })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/profiles/:id (admin only) ─────────────────────────────────────
profileRouter.delete('/profiles/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await prisma.profile.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ status: 'error', message: 'Profile not found' })

    await prisma.profile.delete({ where: { id: req.params.id } })
    // Invalidate all profile caches including the specific ID cache
    await cacheInvalidatePrefix('profiles:list')
    await cacheInvalidatePrefix('profiles:search')
    await cacheInvalidatePrefix(`profiles:id:${req.params.id}`)

    res.json({ status: 'success', message: 'Profile deleted' })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/profiles/upload (admin only) ────────────────────────────────────
// Accepts a multipart CSV upload, streams it through the ingestion pipeline.
// Returns a summary of inserted/skipped rows.
profileRouter.post(
  '/profiles/upload',
  requireRole('admin'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ status: 'error', message: 'No file uploaded. Use field name: file' })
      }

      // req.file.buffer is the full file in memory (capped at 50MB by multer).
      // ingestCsv streams it row-by-row — memory usage stays flat.
      const stats = await ingestCsv(req.file.buffer)

      res.json({
        status: 'success',
        total_rows: stats.total_rows,
        inserted: stats.inserted,
        skipped: stats.skipped,
        reasons: stats.reasons,
      })
    } catch (err) {
      next(err)
    }
  }
)