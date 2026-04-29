/**
 * apiVersionCheck — rejects requests missing X-API-Version: 1
 * Applied to all /api/* routes
 */
export function apiVersionCheck(req, res, next) {
  const version = req.headers['x-api-version']
  if (version !== '1') {
    return res.status(400).json({
      status: 'error',
      message: 'API version header required',
    })
  }
  next()
}