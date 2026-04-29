/**
 * Builds a Prisma `where` object from query params.
 * Works for both direct GET params and parsed NLP results.
 */
export function buildProfileFilters(q = {}) {
  const where = {}

  if (q.gender) where.gender = q.gender
  if (q.age_group) where.age_group = q.age_group
  if (q.country_id) where.country_id = q.country_id.toUpperCase()

  if (q.min_age || q.max_age) {
    where.age = {}
    if (q.min_age) where.age.gte = parseInt(q.min_age)
    if (q.max_age) where.age.lte = parseInt(q.max_age)
  }

  if (q.name) {
    where.name = { contains: q.name }
  }

  return where
}

const SORTABLE = ['name', 'age', 'gender', 'country_id', 'gender_probability', 'country_probability', 'created_at']

/**
 * Builds a Prisma `orderBy` array from sort_by / order params.
 */
export function buildOrderBy(q = {}) {
  const field = SORTABLE.includes(q.sort_by) ? q.sort_by : 'created_at'
  const dir = q.order === 'asc' ? 'asc' : 'desc'
  return [{ [field]: dir }]
}