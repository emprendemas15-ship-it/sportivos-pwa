import { app } from './app.js'
import { env } from './lib/env.js'
import { prisma } from './lib/prisma.js'

const server = app.listen(env.PORT, () => {
  console.info(`Sportivos API listening on http://localhost:${env.PORT}`)
})

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
