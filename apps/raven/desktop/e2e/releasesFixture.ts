import { createServer } from 'node:http'
import { SERVER_METHODS } from '@/shared/protocol'

const RELEASES_PATH = '/releases'

export type ReleasesFixture = {
  /** What `RAVEN_DESKTOP_RELEASES_URL` points at. */
  url: string
  /** How many times `GET /releases` has been asked, every page counted. */
  requests: () => number
  close: () => Promise<void>
}

const pageOf = (search: URLSearchParams): number => {
  const page = search.get('page') ?? '1'
  return /^[1-9]\d{0,2}$/.test(page) ? Number(page) : 0
}

/**
 * A stand-in for GitHub's releases list on `127.0.0.1`, so no e2e run ever asks GitHub.
 * `releases` is the one page; `pages` serves each in turn, linked by `Link: rel="next"` as
 * GitHub links them.
 */
export const startReleasesFixture = async ({
  releases = [],
  pages,
}: {
  releases?: unknown
  pages?: readonly unknown[]
}): Promise<ReleasesFixture> => {
  const bodies = (pages ?? [releases]).map((page) => JSON.stringify(page))
  const counted = { releases: 0 }
  const served = { url: '' }
  const server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://127.0.0.1')
    const page = pageOf(searchParams)
    const body = bodies.at(page - 1)
    if (
      request.method !== SERVER_METHODS.get ||
      pathname !== RELEASES_PATH ||
      page === 0 ||
      body === undefined
    ) {
      response.writeHead(404).end()
      return
    }
    counted.releases += 1
    const link =
      page < bodies.length ? { link: `<${served.url}?page=${page + 1}>; rel="next"` } : {}
    response.writeHead(200, { 'content-type': 'application/json', ...link }).end(body)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No releases fixture port')
  served.url = `http://127.0.0.1:${address.port}/releases`
  return {
    url: served.url,
    requests: () => counted.releases,
    close: () =>
      new Promise((resolve) => {
        if (!server.listening) return resolve()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
