import { PrismaClient } from '@prisma/client'
import { uuidv7 } from 'uuidv7'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const prisma = new PrismaClient()

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Spread created_at timestamps evenly across 2024 so the data
 * looks realistic for sorting / filtering by date.
 */
function spreadCreatedAt(index, total) {
  const start = new Date('2024-01-01T00:00:00Z').getTime()
  const end   = new Date('2024-12-31T23:59:59Z').getTime()
  const step  = (end - start) / total
  // Small random jitter (±6 hours) so timestamps aren't perfectly linear
  const jitter = (Math.random() - 0.5) * 6 * 60 * 60 * 1000
  return new Date(start + step * index + jitter)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Starting seed from seed_profiles.json …\n')

  const raw = readFileSync(join(__dirname, 'seed_profiles.json'), 'utf-8')
  const { profiles } = JSON.parse(raw)

  console.log(`📦 Loaded ${profiles.length} profiles`)

  // Check how many already exist (safe re-run)
  const existing = await prisma.profile.count()
  if (existing > 0) {
    console.log(`⚠️  ${existing} profiles already in DB.`)
    console.log('   Upserting — existing records will be skipped, new ones inserted.\n')
  }

  // ── Upsert in batches of 100 ──────────────────────────────────────────────
  const BATCH = 10
  let inserted = 0

  for (let i = 0; i < profiles.length; i += BATCH) {
    const batch = profiles.slice(i, i + BATCH)

    for (const [batchIndex, p] of batch.entries()) {
      const globalIndex = i + batchIndex
      await prisma.profile.upsert({  // ← await each one, no Promise.all
        where:  { name: p.name },
        update: {},
        create: {
          id:                  uuidv7(),
          name:                p.name,
          gender:              p.gender,
          gender_probability:  p.gender_probability,
          age:                 p.age,
          age_group:           p.age_group,
          country_id:          p.country_id,
          country_name:        p.country_name,
          country_probability: p.country_probability,
          created_at:          spreadCreatedAt(globalIndex, profiles.length),
        },
      })
      inserted++;
    }
    process.stdout.write(`\r✅ Processed ${Math.min(inserted, profiles.length)} / ${profiles.length}`)
  }

  // ── Final count ───────────────────────────────────────────────────────────
  const total = await prisma.profile.count()
  const newRecords = total - existing

  console.log(`\n\n📊 Summary`)
  console.log(`   Profiles processed : ${profiles.length}`)
  console.log(`   New records added  : ${newRecords}`)
  console.log(`   Total in DB        : ${total}`)
  console.log('\n🎉 Seed complete.')
}

main()
  .catch((e) => { console.error('\n❌ Seed failed:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
