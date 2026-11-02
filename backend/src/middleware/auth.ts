import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../lib/env.js'
import { prisma } from '../lib/prisma.js'

export type AuthenticatedRequest = Request & {
  user?: { id: string; role: string }
}

export async function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  const header = request.header('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    response.status(401).json({ error: 'Se requiere iniciar sesión.' })
    return
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    if (typeof payload === 'string' || !payload.sub) {
      response.status(401).json({ error: 'La sesión no es válida.' })
      return
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    })
    if (!user || !user.active) {
      response.status(401).json({ error: 'La sesión no está activa.' })
      return
    }

    request.user = { id: user.id, role: user.role.name }
    next()
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      response.status(401).json({ error: 'La sesión expiró o no es válida.' })
      return
    }
    next(error)
  }
}
