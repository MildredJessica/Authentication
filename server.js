import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import morgan from 'morgan'

import { authRouter } from './routes/auth.js'
import { profileRouter } from './routes/profiles.js'
import { requireAuth } from './middleware/requireAuth.js'
import { apiVersionCheck } from './middleware/apiVersion.js'
import { rateLimiter, authRateLimiter } from './middleware/rateLimiter.js'
import { requestLogger, errorHandler } from './middleware/logger.js'
import { verifyAccessToken } from './src/services/authService.js'

const app = express()
const PORT = process.env.PORT || 4000

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin requests (Postman, curl, server-side proxy)
    if (!origin) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Version'],
}))

app.use(express.json())
app.use(cookieParser(process.env.COOKIE_SECRET))
app.use(morgan('dev'))
app.use(requestLogger)

// ── GET /auth/me ──────────────────────────────────────────────────────────────
app.get('/auth/me', rateLimiter, (req, res) => {
  const token =
    req.cookies?.access_token ||
    req.headers.authorization?.split(' ')[1]

  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Not authenticated' })
  }
  try {
    const payload = verifyAccessToken(token)
    res.json({ status: 'success', data: { id: payload.sub, role: payload.role } })
  } catch {
    res.status(401).json({ status: 'error', message: 'Invalid token' })
  }
})

// ── POST /auth/refresh and /auth/logout — strict rate limit ──────────────────
app.post('/auth/refresh', authRateLimiter, (req, res, next) => authRouter(req, res, next))
app.post('/auth/logout', authRateLimiter, (req, res, next) => authRouter(req, res, next))

// ── All other /auth/* routes — general rate limit ─────────────────────────────
app.use('/auth', rateLimiter, authRouter)

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api', rateLimiter, requireAuth, apiVersionCheck, profileRouter)

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ status: 'error', message: 'Route not found' }))

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler)

app.listen(PORT, () =>
  console.log(`🚀 Insighta Labs+ backend running on http://localhost:${PORT}`)
)

export default app