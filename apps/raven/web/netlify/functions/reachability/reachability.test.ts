import { createHmac } from 'node:crypto'
import { describe, expect, it, mock } from 'bun:test'
import { REACHABILITY_CHECK_PATH, REACHABILITY_PROBLEMS, REMOTE_ACCESS_STATES } from '@raven/core'
import { checkReachability, config } from '@/netlify/functions/reachability/reachability'

const NONCE = 'AbCdEfGhIjKlMnOpQrStUv'
const HOST = 'raven.example.synology.me'
const HOME = '203.0.113.9'
const SECRET = 'the-site-and-raven-share-this'

const signatureOf = (secret: string) => createHmac('sha256', secret).update(NONCE).digest('hex')

const SIGNATURE = signatureOf(SECRET)

const CHECK = `https://raven-player.netlify.app/remote-access/check?host=${HOST}&port=8443&nonce=${NONCE}&signature=${SIGNATURE}`

type ConnectTarget = Parameters<typeof checkReachability>[0]['connectTarget']

type RunProps = {
  url?: string
  secret?: string | null
  resolved?: string[] | Error
  target?: () => Promise<number>
}

const run = async ({
  url = CHECK,
  secret = SECRET,
  resolved = [HOME],
  target = async () => 204,
}: RunProps = {}) => {
  const connectTarget = mock<ConnectTarget>(async () => target())
  const response = await checkReachability({
    request: new Request(url),
    callerAddress: HOME,
    secret,
    resolveHost: async () => {
      if (resolved instanceof Error) throw resolved
      return resolved
    },
    connectTarget,
  })
  return { response, body: await response.json(), connectTarget }
}

const failing = (code: string) => async (): Promise<number> => {
  throw Object.assign(new Error(code), { code })
}

describe('checkReachability', () => {
  it("asks raven's echo at the vetted address and reports it reachable, with the caller's address", async () => {
    const { response, body, connectTarget } = await run()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toEqual({
      state: REMOTE_ACCESS_STATES.reachable,
      publicAddress: HOME,
      resolved: [HOME],
    })
    expect(connectTarget).toHaveBeenCalledWith({
      host: HOST,
      address: HOME,
      port: 8443,
      path: `/api/remote-access/echo/${NONCE}`,
    })
  })

  it('connects to the address it vetted, never resolving the name again', async () => {
    const { connectTarget } = await run({ resolved: ['198.51.100.7', '198.51.100.8'] })
    expect(connectTarget.mock.calls.map(([target]) => target.address)).toEqual(['198.51.100.7'])
  })

  it('refuses a check raven did not sign, looking at nothing', async () => {
    const unsigned = CHECK.replace(`&signature=${SIGNATURE}`, '')
    const results = await Promise.all([
      run({ url: unsigned }),
      run({ url: CHECK.replace(SIGNATURE, signatureOf('another-secret')) }),
      run({ secret: null }),
      run({ secret: '' }),
    ])
    expect(results.map(({ response }) => response.status)).toEqual([400, 403, 403, 403])
    expect(results.every(({ connectTarget }) => connectTarget.mock.calls.length === 0)).toBe(true)
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
    expect(results.every(({ connectTarget }) => connectTarget.mock.calls.length === 0)).toBe(true)
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
    expect(lan.connectTarget).not.toHaveBeenCalled()
    const rebound = await run({ resolved: [HOME, '10.0.0.5'] })
    expect(rebound.body).toMatchObject({ problem: REACHABILITY_PROBLEMS.privateAddress })
    expect(rebound.connectTarget).not.toHaveBeenCalled()
  })

  it('says something else answered when the echo is not a 204', async () => {
    const answered = await Promise.all(
      [200, 302].map((status) => run({ target: async () => status })),
    )
    expect(answered.map(({ body }) => body)).toMatchObject([
      { problem: REACHABILITY_PROBLEMS.notRaven },
      { problem: REACHABILITY_PROBLEMS.notRaven },
    ])
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

describe('the function config', () => {
  it("routes the check at core's path, for GET alone", () => {
    expect(config).toEqual({ path: REACHABILITY_CHECK_PATH, method: ['GET'] })
  })
})
