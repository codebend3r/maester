import { Controller, Delete, Get, Post, Put } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { AdminOnly, ForViewers, audienceMarkProblems } from '@/admin/adminGuard'
import { CONTROLLERS } from '@/appModule'
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
      { method: 'GET', path: '/api/shelves', lock: null, audience: 'admin' },
      { method: 'PUT', path: '/api/shelves/order', lock: null, audience: 'viewers' },
      { method: 'DELETE', path: '/api/shelves/empty', lock: null, audience: 'admin' },
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
