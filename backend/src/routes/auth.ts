import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { env } from '../lib/env.js'
import { prisma } from '../lib/prisma.js'

export const authRouter = Router()

const loginSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1),
})

authRouter.post('/login', async (request, response, next) => {
  try {
    const input = loginSchema.parse(request.body)
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { role: true },
    })

    if (!user || !user.active || !(await bcrypt.compare(input.password, user.passwordHash))) {
      response.status(401).json({ error: 'Correo o contraseña incorrectos.' })
      return
    }

    const token = jwt.sign(
      { role: user.role.name },
      env.JWT_SECRET,
      { subject: user.id, expiresIn: env.JWT_EXPIRES_IN },
    )
    response.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role.name },
    })
  } catch (error) {
    next(error)
  }
})
