import { describe, expect, it, mock } from 'bun:test'
import { REACHABILITY_PROBLEMS, REMOTE_ACCESS_STATES } from '@raven/core'
import { checkReachability } from '@/netlify/functions/reachability/reachability'

const NONCE = 'AbCdEfGhIjKlMnOpQrStUv'
const HOST = 'raven.example.synology.me'
const HOME = '203.0.113.9'

const CHECK = `https://raven-player.netlify.app/remote-access/check?host=${HOST}&port=8443&nonce=${NONCE}`

type RunProps = {
  url?: string
  resolved?: string[] | Error
  target?: () => Promise<Response>
}

const run = async ({
  url = CHECK,
  resolved = [HOME],
  target = async () => new Response(null, { status: 204 }),
}: RunProps = {}) => {
  const fetchTarget = mock(async (_url: string, _init: RequestInit) => target())
  const response = await checkReachability({
    request: new Request(url),
    callerAddress: HOME,
    resolveHost: async () => {
      if (resolved instanceof Error) throw resolved
      return resolved
    },
    fetchTarget,
  })
  return { response, body: await response.json(), fetchTarget }
}

const failing = (code: string) => async (): Promise<Response> => {
  throw new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })
}

describe('checkReachability', () => {
  it("fetches raven's echo at the public origin and reports it reachable, with the caller's address", async () => {
    const { response, body, fetchTarget } = await run()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toEqual({
      state: REMOTE_ACCESS_STATES.reachable,
      publicAddress: HOME,
      resolved: [HOME],
    })
    const [target, init] = fetchTarget.mock.calls[0] ?? []
    expect(target).toBe(`https://${HOST}:8443/api/remote-access/echo/${NONCE}`)
    expect(init?.redirect).toBe('manual')
  })

  it('refuses anything but a DNS name, a port and a nonce, fetching nothing', async () => {
    const bad = [
      CHECK.replace(HOST, '10.0.0.1'),
      CHECK.replace('port=8443', 'port=0'),
      CHECK.replace(NONCE, 'short'),
      'https://raven-player.netlify.app/remote-access/check',
    ]
    const results = await Promise.all(bad.map((url) => run({ url })))
    expect(results.map(({ response }) => response.status)).toEqual([400, 400, 400, 400])
    expect(results.every(({ fetchTarget }) => fetchTarget.mock.calls.length === 0)).toBe(true)
  })

  it('says the name does not resolve, or resolves to a private address, without fetching', async () => {
    const missing = await run({ resolved: new Error('ENOTFOUND') })
    expect(missing.body).toMatchObject({ problem: REACHABILITY_PROBLEMS.dns, resolved: [] })
    const lan = await run({ resolved: ['192.168.50.6'] })
    expect(lan.body).toMatchObject({
      state: REMOTE_ACCESS_STATES.unreachable,
      problem: REACHABILITY_PROBLEMS.privateAddress,
      resolved: ['192.168.50.6'],
    })
    expect(lan.fetchTarget).not.toHaveBeenCalled()
  })

  it('says something else answered when the echo is not a 204', async () => {
    const { body } = await run({ target: async () => new Response('DSM', { status: 200 }) })
    expect(body).toMatchObject({ problem: REACHABILITY_PROBLEMS.notRaven })
  })

  it('names a timeout, a refusal and a bad certificate', async () => {
    const timedOut = await run({
      target: async () => {
        throw new DOMException('timed out', 'TimeoutError')
      },
    })
    const refused = await run({ target: failing('ECONNREFUSED') })
    const certificate = await run({ target: failing('ERR_TLS_CERT_ALTNAME_INVALID') })
    const slow = await run({ target: failing('UND_ERR_CONNECT_TIMEOUT') })
    expect(
      [timedOut, refused, certificate, slow].map(({ body }) =>
        typeof body === 'object' && body !== null && 'problem' in body ? body.problem : null,
      ),
    ).toEqual([
      REACHABILITY_PROBLEMS.timeout,
      REACHABILITY_PROBLEMS.refused,
      REACHABILITY_PROBLEMS.certificate,
      REACHABILITY_PROBLEMS.timeout,
    ])
  })
})
