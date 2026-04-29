import { verifyAccessToken } from '../src/services/authService.js'
import prisma from '../config/prisma.js'

/**
 * requireAuth — validates access token, attaches req.user
 * Accepts token from:
 *   1. Authorization: Bearer <token>  (CLI)
 *   2. access_token cookie            (web portal)
 */
export async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization
    const token =
        (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null) ||
        req.cookies?.access_token

    if (!token) {
        return res.status(401).json({ status: 'error', message: 'Authentication required' })
    }

    try {
        const payload = verifyAccessToken(token)

        // Verify user still exists and is active in DB
        const user = await prisma.user.findUnique({ where: { id: payload.sub } })
        if (!user) {
            return res.status(401).json({ status: 'error', message: 'User not found' })
        }
        if (!user.is_active) {
            return res.status(403).json({ status: 'error', message: 'Account is disabled' })
        }

        req.user = user
        next()
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ status: 'error', message: 'Token expired', code: 'TOKEN_EXPIRED' })
        }
        return res.status(401).json({ status: 'error', message: 'Invalid token' })
    }
}

/**
 * requireRole — RBAC guard, must be used after requireAuth
 */
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user?.role)) {
            return res.status(403).json({
                status: 'error',
                message: `Access denied. Required role: ${roles.join(' or ')}`,
            })
        }
        next()
    }
}