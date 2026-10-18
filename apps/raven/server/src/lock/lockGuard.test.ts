import { Controller, Delete, Get, HttpException, NotFoundException, Put } from '@nestjs/common'
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host'
import { LOCKED_STATUS } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { CONTROLLERS } from '@/appModule'
import { LockGuard, PrivateBy, Public, lockMarkProblems } from '@/lock/lockGuard'
import { MediaPlane } from '@/media/mediaPlaneMark'
import { assertRoutesMarked, routeMarks } from '@/routeMarks'

@Controller('api/things')
@PrivateBy('media')
class ThingsController {
  @Get(':id')
  one(): string {
    return 'one'
  }

  @MediaPlane()
  @Get(':id/bytes')
  bytes(): string {
    return 'bytes'
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

  @MediaPlane()
  @Put(':id/x')
  write(): string {
    return 'x'
  }

  @MediaPlane()
  @PrivateBy('item')
  @Get(':id/y')
  held(): string {
    return 'y'
  }

  @MediaPlane()
  @Public()
  @Get('open')
  open(): string {
    return 'open'
  }
}

@Controller('api/shut')
@PrivateBy('media')
class ShutController {
  @MediaPlane()
  @Get(':id/bytes')
  bytes(): string {
    return 'bytes'
  }

  @Get(':id/plain')
  plain(): string {
    return 'plain'
  }
}

describe('the lock marks on routes', () => {
  it('reads each route with its own mark, or else its controller’s', () => {
    expect(routeMarks([ThingsController])).toEqual([
      { method: 'GET', path: '/api/things/:id', lock: 'media', audience: null, mediaPlane: false },
      {
        method: 'GET',
        path: '/api/things/:id/bytes',
        lock: 'media',
        audience: null,
        mediaPlane: true,
      },
      {
        method: 'PUT',
        path: '/api/things/:id/open',
        lock: 'public',
        audience: null,
        mediaPlane: false,
      },
    ])
  })

  it('finds a route that takes a parameter unmarked, and a held one with no id', () => {
    expect(lockMarkProblems(routeMarks([LooseController]))).toEqual([
      'DELETE /api/loose/:id takes a parameter but is marked neither PrivateBy nor Public',
      "GET /api/loose is marked PrivateBy('library') but has no :id",
      'PUT /api/loose/:id/x is marked MediaPlane but is not a GET',
      "GET /api/loose/:id/y is marked MediaPlane but is held by PrivateBy('item') rather than 'media'",
    ])
    expect(() => assertRoutesMarked([LooseController])).toThrow(
      "Unmarked routes: DELETE /api/loose/:id takes a parameter but is marked neither PrivateBy nor Public; GET /api/loose is marked PrivateBy('library') but has no :id; PUT /api/loose/:id/x is marked MediaPlane but is not a GET",
    )
  })

  it('lists exactly the media streaming routes as the media plane', () => {
    const plane = routeMarks(CONTROLLERS)
      .filter((route) => route.mediaPlane)
      .map((route) => `${route.method} ${route.path}`)
      .toSorted()
    expect(plane).toEqual([
      'GET /api/media-origins/ping',
      'GET /api/media/:id/file',
      'GET /api/media/:id/stream',
      'GET /api/media/:id/subtitles/:trackId',
    ])
  })

  it('has every route of the server marked', () => {
    expect(lockMarkProblems(routeMarks(CONTROLLERS))).toEqual([])
  })
})

describe('the lock guard and a media ticket', () => {
  const VALID = 'good-ticket'

  const guard = ({ isAdminLocked = false }: { isAdminLocked?: boolean } = {}) =>
    new LockGuard(
      {
        viewer: () => ({
          listsLibrary: () => false,
          seesLibrary: () => false,
          seesItem: () => false,
          sees: () => false,
        }),
      },
      { isLocked: () => isAdminLocked },
      { verify: ({ ticket, id }) => ticket === VALID && id === 7 },
      { isTicket: () => false },
    )

  const contextOf = ({
    controller,
    handler,
    query,
  }: {
    controller: new () => object
    handler: () => string
    query: Record<string, unknown>
  }) => new ExecutionContextHost([{ params: { id: '7' }, query, headers: {} }], controller, handler)

  const bytes = new ShutController().bytes
  const plain = new ShutController().plain

  it('lets a good ticket through on a media plane route', () => {
    expect(
      guard().canActivate(
        contextOf({ controller: ShutController, handler: bytes, query: { t: VALID } }),
      ),
    ).toBe(true)
  })

  it('refuses the same ticket on a route that is not marked media plane', () => {
    const refused = (): boolean =>
      guard().canActivate(
        contextOf({ controller: ShutController, handler: plain, query: { t: VALID } }),
      )
    expect(refused).toThrow(HttpException)
    expect(refused).toThrow(expect.objectContaining({ status: LOCKED_STATUS }))
  })

  it('refuses a ticket for another video, a missing one, and one that is not a string', () => {
    const refusals = [{ t: 'other-ticket' }, {}, { t: [VALID] }].map(
      (query) => () =>
        guard().canActivate(contextOf({ controller: ShutController, handler: bytes, query })),
    )
    refusals.forEach((refused) => {
      expect(refused).toThrow(expect.objectContaining({ status: LOCKED_STATUS }))
    })
  })

  it('answers 404 to a refused ticket while the admin lock holds', () => {
    const refused = (): boolean =>
      guard({ isAdminLocked: true }).canActivate(
        contextOf({ controller: ShutController, handler: bytes, query: { t: 'nope' } }),
      )
    expect(refused).toThrow(NotFoundException)
  })
})
