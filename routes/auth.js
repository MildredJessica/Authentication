import { Router } from 'express'
import crypto from 'crypto'
import {
  exchangeGitHubCode,
  upsertUser,
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from '../src/services/authService.js'

export const authRouter = Router()

const SCOPES = 'read:user user:email'
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: parseInt(process.env.REFRESH_TOKEN_EXPIRY_MS || '300000'),
  path: '/',
}

// In-memory state store — maps state → { isCliFlow, expiresAt }
// PKCE is handled by GitHub natively; we don't need to relay code_verifier
// through the backend for the web flow.
const pendingStates = new Map()

// ── GET /auth/github ──────────────────────────────────────────────────────────
authRouter.get('/github', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex')

  const isCliFlow = Boolean(req.query.cli)
  const cli_port = req.query.cli_port

  pendingStates.set(state, {
    isCliFlow,
    cli_port, // ✅ STORE THIS
    expiresAt: Date.now() + 10 * 60 * 1000,
  })

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_CALLBACK_URL,
    scope: SCOPES,
    state,
  })

  res.redirect(`https://github.com/login/oauth/authorize?${params}`)
})

// ── GET /auth/github/callback ─────────────────────────────────────────────────
authRouter.get('/github/callback', async (req, res) => {
  const { code, state } = req.query

  const pending = pendingStates.get(state)
  if (!pending || pending.expiresAt < Date.now()) {
    pendingStates.delete(state)
    return res.status(400).json({ status: 'error', message: 'Invalid or expired state' })
  }
  pendingStates.delete(state)

  try {
    const { ghUser, email } = await exchangeGitHubCode(code)
    const user = await upsertUser(ghUser, email)

    if (!user.is_active) {
      return res.status(403).json({ status: 'error', message: 'Account is disabled' })
    }

    const accessToken = generateAccessToken(user)
    const refreshToken = await generateRefreshToken(user.id)

    if (pending.isCliFlow) {
      const params = new URLSearchParams({
        access_token: accessToken,
        refresh_token: refreshToken,
        username: user.username,
        role: user.role,
        id: user.id
      })
      return res.redirect(`http://localhost:${pending.cli_port}/callback?${params}`)
    }

    // Web flow — set HTTP-only cookies and redirect to dashboard
    res.cookie('access_token', accessToken, { ...COOKIE_OPTS, maxAge: 3 * 60 * 1000 })
    res.cookie('refresh_token', refreshToken, COOKIE_OPTS)
    res.redirect(`${process.env.FRONTEND_URL}/dashboard`)
  } catch (err) {
    console.error('[auth/callback]', err)
    if (pending && pending.isCliFlow && pending.cli_port) {
      return res.redirect(`http://localhost:${pending.cli_port}/callback?error=${encodeURIComponent(err.message)}`)
    }
    res.status(500).json({ status: 'error', message: 'Authentication failed' })
  }
})

// ── POST /auth/refresh ────────────────────────────────────────────────────────
authRouter.post('/refresh', async (req, res) => {
  const rawToken = req.cookies?.refresh_token || req.body?.refresh_token

  if (!rawToken) {
    return res.status(401).json({ status: 'error', message: 'Refresh token required' })
  }

  try {
    const { access_token, refresh_token } = await rotateRefreshToken(rawToken)

    if (req.cookies?.refresh_token) {
      res.cookie('access_token', access_token, { ...COOKIE_OPTS, maxAge: 3 * 60 * 1000 })
      res.cookie('refresh_token', refresh_token, COOKIE_OPTS)
    }

    res.json({ status: 'success', access_token, refresh_token })
  } catch (err) {
    res.status(401).json({ status: 'error', message: err.message })
  }
})

// ── POST /auth/logout ─────────────────────────────────────────────────────────
authRouter.post('/logout', async (req, res) => {
  const rawToken = req.cookies?.refresh_token || req.body?.refresh_token
  await revokeRefreshToken(rawToken)
  res.clearCookie('access_token')
  res.clearCookie('refresh_token')
  res.json({ status: 'success', message: 'Logged out' })
})

// ── GET /auth/me ──────────────────────────────────────────────────────────────
// authRouter.get('/me', async (req, res) => {
//   try {
//     const token = req.cookies?.access_token || req.headers.authorization?.split(' ')[1]
//     if (!token) return res.status(401).json({ status: 'error', message: 'Not authenticated' })

    
//       const { verifyAccessToken } = await import('../src/services/authService.js')
//       const payload = verifyAccessToken(token)
//       const user = await prisma.user.findUnique({
//         where: { id: payload.sub },
//       })
  
//       if (!user || !user.is_active) {
//         return res.status(403).json({
//           status: 'error',
//           message: 'User inactive',
//         })
//       }
//       res.json({ status: 'success', data: { id: payload.sub, role: payload.role } })
//   } catch {
//     res.status(401).json({ status: 'error', message: 'Invalid token' })
//   }
// })


