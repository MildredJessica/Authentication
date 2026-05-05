import { parse } from 'csv-parse'
import { Readable } from 'stream'
import { uuidv7 } from 'uuidv7'
import prisma from '../../config/prisma.js'
import { cacheInvalidatePrefix } from '../../config/redis.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const CHUNK_SIZE   = 500   // rows per DB batch insert
const VALID_GENDERS    = new Set(['male', 'female'])
const VALID_AGE_GROUPS = new Set(['child', 'teenager', 'adult', 'senior'])

const REQUIRED_COLUMNS = [
  'name', 'gender', 'gender_probability', 'age',
  'age_group', 'country_id', 'country_name', 'country_probability',
]

// ── Row validator ─────────────────────────────────────────────────────────────

function validateRow(row) {
  // Required fields present and non-empty
  for (const col of REQUIRED_COLUMNS) {
    if (!row[col]?.toString().trim()) {
      return { valid: false, reason: 'missing_fields' }
    }
  }

  // name — non-empty string
  const name = row.name.trim()
  if (!name) return { valid: false, reason: 'missing_fields' }

  // gender
  if (!VALID_GENDERS.has(row.gender.toLowerCase().trim())) {
    return { valid: false, reason: 'invalid_gender' }
  }

  // age — positive integer
  const age = parseInt(row.age, 10)
  if (!Number.isFinite(age) || age < 0 || age > 150) {
    return { valid: false, reason: 'invalid_age' }
  }

  // age_group
  if (!VALID_AGE_GROUPS.has(row.age_group.toLowerCase().trim())) {
    return { valid: false, reason: 'invalid_age_group' }
  }

  // country_id — 2-letter ISO code
  const countryId = row.country_id.toUpperCase().trim()
  if (!/^[A-Z]{2}$/.test(countryId)) {
    return { valid: false, reason: 'invalid_country_id' }
  }

  // probabilities — floats between 0 and 1
  const gp = parseFloat(row.gender_probability)
  const cp = parseFloat(row.country_probability)
  if (!Number.isFinite(gp) || gp < 0 || gp > 1) return { valid: false, reason: 'invalid_gender_probability' }
  if (!Number.isFinite(cp) || cp < 0 || cp > 1) return { valid: false, reason: 'invalid_country_probability' }

  return {
    valid: true,
    data: {
      id: uuidv7(),
      name,
      gender: row.gender.toLowerCase().trim(),
      gender_probability: gp,
      age,
      age_group: row.age_group.toLowerCase().trim(),
      country_id: countryId,
      country_name: row.country_name.trim(),
      country_probability: cp,
    },
  }
}

// ── Chunk inserter ────────────────────────────────────────────────────────────
//
// Uses INSERT IGNORE to skip duplicate names at the DB level —
// faster than a SELECT-then-INSERT for each row, and handles
// races between concurrent uploads correctly.

async function insertChunk(rows) {
  if (!rows.length) return { inserted: 0, duplicates: 0 }

  // Build raw SQL for bulk insert with INSERT IGNORE
  // Prisma doesn't support INSERT IGNORE natively, so we use $executeRaw
  const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())').join(', ')
  const values = rows.flatMap(r => [
    r.id,
    r.name,
    r.gender,
    r.gender_probability,
    r.age,
    r.age_group,
    r.country_id,
    r.country_name,
    r.country_probability,
  ])

  const result = await prisma.$executeRaw`
    INSERT IGNORE INTO profiles
      (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability, created_at)
    VALUES ${prisma.$raw(
      rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())').join(', ')
    )}
  `

  // affectedRows tells us how many were actually inserted
  // rows.length - affectedRows = duplicates skipped by INSERT IGNORE
  return { inserted: result, duplicates: rows.length - result }
}

// ── Raw SQL bulk insert (workaround for Prisma $executeRaw with dynamic values) ──

async function bulkInsert(rows) {
  if (!rows.length) return { inserted: 0, duplicates: 0 }

  // Use createMany with skipDuplicates — Prisma translates this to INSERT IGNORE on MySQL
  const result = await prisma.profile.createMany({
    data: rows,
    skipDuplicates: true,
  })

  return {
    inserted: result.count,
    duplicates: rows.length - result.count,
  }
}

// ── Main ingestion function ───────────────────────────────────────────────────
//
// Accepts a Buffer or Readable stream.
// Streams rows through the CSV parser, validates each row,
// accumulates valid rows into chunks, and inserts each chunk as a batch.
//
// Never holds more than CHUNK_SIZE rows in memory.
// A failed chunk insert does NOT abort the upload — remaining chunks continue.

export async function ingestCsv(input) {
  const stats = {
    total_rows: 0,
    inserted: 0,
    skipped: 0,
    reasons: {},
  }

  const addSkip = (reason) => {
    stats.skipped++
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1
  }

  // Convert Buffer to Readable if needed
  const stream = Buffer.isBuffer(input)
    ? Readable.from(input)
    : input

  const parser = stream.pipe(
    parse({
      columns: true,           // use first row as header
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true, // don't throw on wrong column count — we validate manually
      bom: true,                // strip BOM if present
    })
  )

  let chunk = []

  for await (const row of parser) {
    stats.total_rows++

    // Skip malformed rows (wrong column count after relax)
    if (!row || typeof row !== 'object') {
      addSkip('malformed_row')
      continue
    }

    const result = validateRow(row)
    if (!result.valid) {
      addSkip(result.reason)
      continue
    }

    chunk.push(result.data)

    if (chunk.length >= CHUNK_SIZE) {
      try {
        const { inserted, duplicates } = await bulkInsert(chunk)
        stats.inserted += inserted
        if (duplicates > 0) {
          stats.skipped += duplicates
          stats.reasons.duplicate_name = (stats.reasons.duplicate_name || 0) + duplicates
        }
      } catch (err) {
        // Chunk-level failure — mark all rows in this chunk as skipped
        // rather than aborting the entire upload
        console.error('[csv-ingest] chunk insert failed:', err.message)
        stats.skipped += chunk.length
        stats.reasons.insert_error = (stats.reasons.insert_error || 0) + chunk.length
      }
      chunk = []
    }
  }

  // Flush final partial chunk
  if (chunk.length) {
    try {
      const { inserted, duplicates } = await bulkInsert(chunk)
      stats.inserted += inserted
      if (duplicates > 0) {
        stats.skipped += duplicates
        stats.reasons.duplicate_name = (stats.reasons.duplicate_name || 0) + duplicates
      }
    } catch (err) {
      console.error('[csv-ingest] final chunk insert failed:', err.message)
      stats.skipped += chunk.length
      stats.reasons.insert_error = (stats.reasons.insert_error || 0) + chunk.length
    }
  }

  // Invalidate profile cache — new data is now in the DB
  await cacheInvalidatePrefix('profiles')

  return stats
}
