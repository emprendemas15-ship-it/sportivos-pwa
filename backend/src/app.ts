import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { requireAuth } from './middleware/auth.js'
import { errorHandler } from './middleware/errors.js'
import { authRouter } from './routes/auth.js'
import { productsRouter } from './routes/products.js'
import { env } from './lib/env.js'

export const app = express()

app.use(helmet())
app.use(cors({ origin: env.FRONTEND_ORIGIN }))
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})
app.use('/api/auth', authRouter)
app.use('/api/products', requireAuth, productsRouter)
app.use(errorHandler)
