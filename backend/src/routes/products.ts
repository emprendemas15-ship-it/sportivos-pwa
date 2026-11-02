import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { prisma } from '../lib/prisma.js'

export const productsRouter = Router()

const productSchema = z.object({
  code: z.string().trim().min(1).max(40).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional().nullable(),
  retailPrice: z.coerce.number().finite().min(0),
  wholesalePrice: z.coerce.number().finite().min(0).optional().nullable(),
})

const productSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  retailPrice: true,
  wholesalePrice: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect

productsRouter.get('/', async (request, response, next) => {
  try {
    const search = z.string().trim().max(100).catch('').parse(request.query.search)
    const products = await prisma.product.findMany({
      where: {
        active: true,
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: productSelect,
      orderBy: { name: 'asc' },
    })

    const activeProducts = await prisma.product.findMany({
      where: { active: true },
      select: { id: true },
    })
    const [entryTotals, saleTotals] = await Promise.all([
      prisma.inventoryEntry.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
        where: { productId: { in: activeProducts.map((product) => product.id) } },
      }),
      prisma.saleItem.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
        where: { productId: { in: activeProducts.map((product) => product.id) } },
      }),
    ])
    const incomingByProduct = new Map(
      entryTotals.map((entry) => [entry.productId, Number(entry._sum.quantity ?? 0)]),
    )
    const soldByProduct = new Map(
      saleTotals.map((sale) => [sale.productId, Number(sale._sum.quantity ?? 0)]),
    )
    const result = products.map((product) => ({
      ...product,
      retailPrice: Number(product.retailPrice),
      wholesalePrice: product.wholesalePrice === null ? null : Number(product.wholesalePrice),
      stock: (incomingByProduct.get(product.id) ?? 0) - (soldByProduct.get(product.id) ?? 0),
    }))
    const totalStock = activeProducts.reduce(
      (sum, product) => sum + (incomingByProduct.get(product.id) ?? 0) - (soldByProduct.get(product.id) ?? 0),
      0,
    )
    const outOfStockProducts = activeProducts.filter(
      (product) => (incomingByProduct.get(product.id) ?? 0) - (soldByProduct.get(product.id) ?? 0) <= 0,
    ).length

    response.json({
      products: result,
      summary: {
        activeProducts: activeProducts.length,
        totalStock,
        outOfStockProducts,
      },
    })
  } catch (error) {
    next(error)
  }
})

productsRouter.post('/', async (request: AuthenticatedRequest, response, next) => {
  try {
    const input = productSchema.parse(request.body)
    const product = await prisma.$transaction(async (transaction) => {
      const created = await transaction.product.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          retailPrice: new Prisma.Decimal(input.retailPrice),
          wholesalePrice:
            input.wholesalePrice == null ? null : new Prisma.Decimal(input.wholesalePrice),
        },
        select: productSelect,
      })
      await transaction.auditLog.create({
        data: {
          ...(request.user ? { userId: request.user.id } : {}),
          entityType: 'Product',
          entityId: created.id,
          action: 'CREATE',
          after: {
            code: created.code,
            name: created.name,
            retailPrice: created.retailPrice.toString(),
          },
        },
      })
      return created
    })
    response.status(201).json({
      product: {
        ...product,
        retailPrice: Number(product.retailPrice),
        wholesalePrice: product.wholesalePrice === null ? null : Number(product.wholesalePrice),
        stock: 0,
      },
    })
  } catch (error) {
    next(error)
  }
})
