import { Controller, Delete, Get, Put } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { CONTROLLERS } from '@/appModule'
import { PrivateBy, Public, assertLockMarked, lockMarkProblems, routeMarks } from '@/lock/lockGuard'

@Controller('api/things')
@PrivateBy('media')
class ThingsController {
  @Get(':id')
  one(): string {
    return 'one'
  }

  @Public()
  @Put(':id/open')
  open(): string {
    return 'open'
  }
}

@Controller('api/loose')
class LooseController {
  @Delete(':id')
  remove(): string {
    return 'gone'
  }

  @PrivateBy('library')
  @Get()
  all(): string {
    return 'all'
  }

  @Get('plain')
  plain(): string {
    return 'plain'
  }
}

describe('the lock marks on routes', () => {
  it('reads each route with its own mark, or else its controller’s', () => {
    expect(routeMarks([ThingsController])).toEqual([
      { method: 'GET', path: '/api/things/:id', mark: 'media' },
      { method: 'PUT', path: '/api/things/:id/open', mark: 'public' },
    ])
  })

  it('finds a route that takes a parameter unmarked, and a held one with no id', () => {
    expect(lockMarkProblems(routeMarks([LooseController]))).toEqual([
      'DELETE /api/loose/:id takes a parameter but is marked neither PrivateBy nor Public',
      "GET /api/loose is marked PrivateBy('library') but has no :id",
    ])
    expect(() => assertLockMarked([LooseController])).toThrow('Unmarked routes')
  })

  it('has every route of the server marked', () => {
    expect(lockMarkProblems(routeMarks(CONTROLLERS))).toEqual([])
  })
})
