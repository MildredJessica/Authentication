// ── Request logger ─────────────────────────────────────────────────────────
export function requestLogger(req, res, next) {
  const start = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - start
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`
    )
  })
  next()
}

// ── Global error handler ───────────────────────────────────────────────────
export function errorHandler(err, _req, res, _next) {
  console.error('[error]', err)
  const status = err.status || err.statusCode || 500
  res.status(status).json({
    status: 'error',
    message: err.message || 'Internal server error',
  })
}