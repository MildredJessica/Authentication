/**
 * Generates HATEOAS-style pagination links.
 * Uses the original request path + current query params, overriding page.
 */
export function paginationLinks(req, page, total_pages, limit) {
  const base = req.path
  const params = new URLSearchParams(req.query)

  const build = (p) => {
    params.set('page', p)
    params.set('limit', limit)
    return `${base}?${params.toString()}`
  }

  return {
    self: build(page),
    next: page < total_pages ? build(page + 1) : null,
    prev: page > 1 ? build(page - 1) : null,
  }
}