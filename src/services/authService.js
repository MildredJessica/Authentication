import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import prisma from '../../config/prisma.js'

const ACCESS_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '3m'
const REFRESH_EXPIRY_MS = parseInt(process.env.REFRESH_TOKEN_EXPIRY_MS || '300000')

// ── Token generation ─────────────────────────────────────────────────────────

export function generateAccessToken(user) {
    return jwt.sign(
        { sub: user.id, role: user.role, is_active: user.is_active },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_EXPIRY }
    )
}

export async function generateRefreshToken(userId) {
    const raw = crypto.randomBytes(64).toString('hex')
    const hash = crypto.createHash('sha256').update(raw).digest('hex')

    await prisma.refreshToken.create({
        data: {
            user_id: userId,
            token_hash: hash,
            expires_at: new Date(Date.now() + REFRESH_EXPIRY_MS),
        },
    })

    return raw
}

export function verifyAccessToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET)
}

// ── Refresh rotation ─────────────────────────────────────────────────────────

export async function rotateRefreshToken(rawToken) {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex')

    const stored = await prisma.refreshToken.findUnique({ where: { token_hash: hash } })

    if (!stored || stored.revoked || stored.expires_at < new Date()) {
        throw new Error('Invalid or expired refresh token')
    }

    // Revoke old token immediately (rotation)
    await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revoked: true },
    })

    const user = await prisma.user.findUnique({ where: { id: stored.user_id } })
    if (!user || !user.is_active) throw new Error('User not found or inactive')

    const newAccess = generateAccessToken(user)
    const newRefresh = await generateRefreshToken(user.id)

    return { access_token: newAccess, refresh_token: newRefresh, user }
}

// ── Revoke on logout ─────────────────────────────────────────────────────────

export async function revokeRefreshToken(rawToken) {
    if (!rawToken) return
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex')
    await prisma.refreshToken
        .updateMany({ where: { token_hash: hash }, data: { revoked: true } })
        .catch(() => null)
}

// ── GitHub OAuth exchange ─────────────────────────────────────────────────────

export async function exchangeGitHubCode(code) {
    const params = new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_CALLBACK_URL,
    })

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'InsightaLabs' },
        body: params.toString(),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
        throw new Error(`GitHub did not return an access token: ${JSON.stringify(tokenData)}`)
    }

    const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'InsightaLabs' },
    })
    const ghUser = await userRes.json()

    // Fetch primary email if not public
    let email = ghUser.email
    if (!email) {
        const emailRes = await fetch('https://api.github.com/user/emails', {
            headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'InsightaLabs' },
        })
        const emails = await emailRes.json()
        email = emails.find((e) => e.primary)?.email ?? null
    }

    return { ghUser, email }
}

// ── Upsert user ───────────────────────────────────────────────────────────────

export async function upsertUser(ghUser, email) {
    const { uuidv7 } = await import('uuidv7')

    const existing = await prisma.user.findUnique({ where: { github_id: String(ghUser.id) } })

    if (existing) {
        return prisma.user.update({
            where: { id: existing.id },
            data: {
                username: ghUser.login,
                email: email ?? existing.email,
                avatar_url: ghUser.avatar_url,
                last_login_at: new Date(),
            },
        })
    }

    return prisma.user.create({
        data: {
            id: uuidv7(),
            github_id: String(ghUser.id),
            username: ghUser.login,
            email,
            avatar_url: ghUser.avatar_url,
            role: 'analyst',
            is_active: true,
            last_login_at: new Date(),
        },
    })
}