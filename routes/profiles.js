import { Router } from 'express'
import {stringify} from 'csv-stringify'
import prisma from '../config/prisma.js'
import { requireRole } from '../middleware/requireAuth.js'
import { fetchProfileData } from '../src/services/profileService.js'
import { buildProfileFilters, buildOrderBy } from '../src/utils/queryBuilder.js'
import { paginationLinks } from '../src/utils/pagination.js'

export const profileRouter = Router()

// ── GET /api/profiles ─────────────────────────────────────────────────────────
profileRouter.get('/profiles', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10))
    const skip = (page - 1) * limit

    const where = buildProfileFilters(req.query)
    const orderBy = buildOrderBy(req.query)

    const [total, data] = await Promise.all([
      prisma.profile.count({ where }),
      prisma.profile.findMany({ where, orderBy, skip, take: limit }),
    ])

    const total_pages = Math.ceil(total / limit)

    res.json({
      status: 'success',
      page,
      limit,
      total,
      total_pages,
      links: paginationLinks(req, page, total_pages, limit),
      data,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/profiles/search ──────────────────────────────────────────────────
profileRouter.get('/profiles/search', async (req, res, next) => {
  try {
    const { q } = req.query
    if (!q) return res.status(400).json({ status: 'error', message: 'Query parameter q is required' })

    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10))
    const skip = (page - 1) * limit

    // Parse natural language query into filter object
    const filters = parseNaturalLanguage(q)
    const where = buildProfileFilters(filters)

    const [total, data] = await Promise.all([
      prisma.profile.count({ where }),
      prisma.profile.findMany({ where, skip, take: limit, orderBy: { created_at: 'desc' } }),
    ])

    const total_pages = Math.ceil(total / limit)

    res.json({
      status: 'success',
      page,
      limit,
      total,
      total_pages,
      links: paginationLinks(req, page, total_pages, limit),
      data,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/profiles/export ──────────────────────────────────────────────────
profileRouter.get('/profiles/export', async (req, res, next) => {
  try {
    const { format = 'csv' } = req.query
    if (format !== 'csv') {
      return res.status(400).json({ status: 'error', message: 'Only format=csv is supported' })
    }

    const where = buildProfileFilters(req.query)
    const orderBy = buildOrderBy(req.query)

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

    for (const p of profiles) {
      csvStream.write({
        ...p,
        created_at:
          p.created_at instanceof Date
            ? p.created_at.toISOString()
            : p.created_at,
      })
    }
    csvStream.end()
  } catch (err) {
    next(err)
  }
})

// ── GET /api/profiles/:id ─────────────────────────────────────────────────────
profileRouter.get('/profiles/:id', async (req, res, next) => {
  try {
    const profile = await prisma.profile.findUnique({ where: { id: req.params.id } })
    if (!profile) return res.status(404).json({ status: 'error', message: 'Profile not found' })
    res.json({ status: 'success', data: profile })
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
    res.json({ status: 'success', message: 'Profile deleted' })
  } catch (err) {
    next(err)
  }
})

// ── Natural language parser (Stage 2 carry-over) ──────────────────────────────
function parseNaturalLanguage(query) {
  const q = query.toLowerCase()
  const filters = {}

  // Gender
  if (/\bmale\b/.test(q) && !/female/.test(q)) filters.gender = 'male'
  else if (/\bfemale\b|\bwomen\b|\bwoman\b|\bgirl\b/.test(q)) filters.gender = 'female'

  // Age groups
  if (/\byoung\b|\bjunior\b|\bteenager\b|\bteen\b/.test(q)) filters.age_group = 'teenager'
  else if (/\bchild\b|\bkid\b/.test(q)) filters.age_group = 'child'
  else if (/\bsenior\b|\belderly\b|\bold\b/.test(q)) filters.age_group = 'senior'
  else if (/\badult\b/.test(q)) filters.age_group = 'adult'

  // Countries by name keyword
  const countryMap = {
    nigeria: 'NG', nigerian: 'NG',
    ghana: 'GH', ghanaian: 'GH',
    kenya: 'KE', kenyan: 'KE',
    'south africa': 'ZA',
    'united states': 'US', american: 'US', usa: 'US',
    'united kingdom': 'GB', british: 'GB', uk: 'GB',
    france: 'FR', french: 'FR',
    germany: 'DE', german: 'DE',
    india: 'IN', indian: 'IN',
    canada: 'CA', canadian: 'CA',
    benin: 'BJ', senegal: 'SN',
    cameroon: 'CM',
  }
  for (const [keyword, code] of Object.entries(countryMap)) {
    if (q.includes(keyword)) { filters.country_id = code; break }
  }

  return filters
}