import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.enum(['1h', '8h', '12h', '24h']).default('8h'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
})

export const env = envSchema.parse(process.env)
