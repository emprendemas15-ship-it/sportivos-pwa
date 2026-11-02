import bcrypt from 'bcryptjs'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const prisma = new PrismaClient()

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN' },
  })
  await prisma.role.upsert({
    where: { name: 'STAFF' },
    update: {},
    create: { name: 'STAFF' },
  })

  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env
  if (!ADMIN_EMAIL && !ADMIN_PASSWORD) {
    console.info('Roles created. Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD to create an administrator.')
    return
  }
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error('Provide ADMIN_EMAIL and ADMIN_PASSWORD with at least 12 characters.')
  }

  const email = ADMIN_EMAIL.trim().toLowerCase()
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
  await prisma.user.upsert({
    where: { email },
    update: { name: ADMIN_NAME?.trim() || 'Administrador', passwordHash, active: true, roleId: adminRole.id },
    create: {
      name: ADMIN_NAME?.trim() || 'Administrador',
      email,
      passwordHash,
      roleId: adminRole.id,
    },
  })
  console.info(`Administrator ready: ${email}`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
