import { Controller, Delete, ForbiddenException, Get, Post, Put } from '@nestjs/common'
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host'
import { AUTH_REFUSALS } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { AdminGuard, AdminOnly, ForViewers, audienceMarkProblems } from '@/admin/adminGuard'
import { CONTROLLERS } from '@/appModule'
import { ACCOUNT_REQUIREMENTS } from '@/auth/accountGuard'
import { assertRoutesMarked, routeMarks } from '@/routeMarks'

@Controller('api/shelves')
@AdminOnly()
class ShelvesController {
  @Get()
  all(): string {
    return 'all'
  }

  @ForViewers()
  @Put('order')
  order(): string {
    return 'order'
  }

  @Delete('empty')
  empty(): string {
    return 'empty'
  }
}

@Controller('api/loose')
class LooseController {
  @Post('things')
  add(): string {
    return 'added'
  }

  @ForViewers()
  @Get('things')
  things(): string {
    return 'things'
  }

  @AdminOnly()
  @Get('secret')
  secret(): string {
    return 'secret'
  }

  @Get('plain')
  plain(): string {
    return 'plain'
  }
}

describe('who each route is for', () => {
  it('reads each route with its own audience, or else its controller’s', () => {
    expect(routeMarks([ShelvesController])).toEqual([
      {
        method: 'GET',
        path: '/api/shelves',
        lock: null,
        audience: 'admin',
        account: ACCOUNT_REQUIREMENTS.owner,
        mediaPlane: false,
      },
      {
        method: 'PUT',
        path: '/api/shelves/order',
        lock: null,
        audience: 'viewers',
        account: ACCOUNT_REQUIREMENTS.approved,
        mediaPlane: false,
      },
      {
        method: 'DELETE',
        path: '/api/shelves/empty',
        lock: null,
        audience: 'admin',
        account: ACCOUNT_REQUIREMENTS.owner,
        mediaPlane: false,
      },
    ])
  })

  it('finds a route that is not a GET marked for no one, and a GET marked ForViewers', () => {
    expect(audienceMarkProblems(routeMarks([LooseController]))).toEqual([
      'POST /api/loose/things is not a GET but is marked neither AdminOnly nor ForViewers',
      'GET /api/loose/things is marked ForViewers, but a GET is marked AdminOnly or not at all',
    ])
    expect(() => assertRoutesMarked([LooseController])).toThrow(
      'Unmarked routes: POST /api/loose/things is not a GET but is marked neither AdminOnly nor ForViewers; GET /api/loose/things is marked ForViewers',
    )
  })

  it('has every route of the server marked', () => {
    expect(audienceMarkProblems(routeMarks(CONTROLLERS))).toEqual([])
  })
})

describe('the admin guard', () => {
  const guardFor = ({ canManage, isLegacy }: { canManage: boolean; isLegacy: boolean }) =>
    new AdminGuard({ canManage: () => canManage, isLegacy: () => isLegacy })

  const contextOf = (handler: () => string) =>
    new ExecutionContextHost([{ headers: {} }], ShelvesController, handler)

  const shelves = new ShelvesController()

  it('keeps its message for the admin lock when accounts are off', () => {
    const guard = guardFor({ canManage: false, isLegacy: true })
    expect(() => guard.canActivate(contextOf(shelves.all))).toThrow(ForbiddenException)
    expect(() => guard.canActivate(contextOf(shelves.all))).toThrow(
      'The admin lock is on. Turn it off in Settings to do this.',
    )
  })

  it('refuses a caller who is not the owner once accounts are ready', () => {
    const guard = guardFor({ canManage: false, isLegacy: false })
    expect(() => guard.canActivate(contextOf(shelves.all))).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ reason: AUTH_REFUSALS.notOwner }),
      }),
    )
  })

  it('lets through whoever can manage, and any route not marked AdminOnly', () => {
    expect(guardFor({ canManage: true, isLegacy: false }).canActivate(contextOf(shelves.all))).toBe(
      true,
    )
    expect(
      guardFor({ canManage: false, isLegacy: false }).canActivate(contextOf(shelves.order)),
    ).toBe(true)
  })
})
