import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { browser } from '@/lib/browser'
import { ChatPage } from '@/pages/ChatPage/ChatPage'
import { CHAT_STORAGE_KEY, useChat } from '@/stores/chat'
import { eventStream, renderWithQueries } from '@/test/render'

type Sent = { url: string; body: unknown }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const SANDBOX = {
  model: 'fake',
  raven: 'http://localhost:5174',
  world: 'w1',
  case: {
    id: 'simple_request',
    name: 'simple movie request',
    turns: [
      {
        user: 'can you get Dune (2021) in 1080p?',
        expect_tools: ['search_media', 'request_media'],
        forbid_tools: [],
        reply_matches: null,
        reply_not_matches: 'error|failed',
      },
    ],
  },
  cases: [
    { id: 'blank', name: 'Blank world' },
    { id: 'simple_request', name: 'simple movie request' },
  ],
}

const FRIEND = { user: { id: 'eval-user', display_name: 'Sandbox friend' }, tier: 'friend' }

const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** Answers each route from `routes`, and records what was posted. */
const serve = (routes: Record<string, () => Response>) => {
  const sent: Sent[] = []
  const answer = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    if (typeof init?.body === 'string') sent.push({ url, body: JSON.parse(init.body) })
    return routes[url]?.() ?? json({ detail: 'Not Found' }, 404)
  }
  // Bun's fetch type carries `preconnect` too.
  spyOn(globalThis, 'fetch').mockImplementation(Object.assign(answer, { preconnect: () => {} }))
  return sent
}

const sandboxRoutes = (extra: Record<string, () => Response> = {}) => ({
  '/api/me': () => json(FRIEND),
  '/api/sandbox': () => json(SANDBOX),
  ...extra,
})

describe('ChatPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useChat.setState({ owner: null, entries: [], settled: [], isBusy: false })
  })

  it('sends a case message and shows the reply, its tools and the verdict', async () => {
    const sent = serve(
      sandboxRoutes({
        '/api/chat': () =>
          new Response(
            eventStream([
              ['tool', { name: 'search_media', input: { query: 'Dune' }, ok: true, result: '[]' }],
              [
                'tool',
                { name: 'request_media', input: { tmdb_id: 438631 }, ok: true, result: 'ok' },
              ],
              [
                'titles',
                {
                  titles: [
                    {
                      key: 'raven:movie:277',
                      title: 'Dune',
                      year: 2021,
                      logo_url: 'http://localhost:5174/api/items/277/images/logo',
                      links: [
                        {
                          label: '4K Movies 4K HDR',
                          url: 'http://localhost:5174/movies/277?library=4',
                        },
                        { label: 'Bad', url: 'javascript:alert(1)' },
                      ],
                    },
                  ],
                },
              ],
              [
                'text',
                {
                  text: 'Requested Dune (2021) in 1080p. [Watch it in raven](http://localhost:5174/movies/277?library=6)',
                },
              ],
              ['done', {}],
            ]),
          ),
      }),
    )
    renderWithQueries(<ChatPage />)

    expect(
      await screen.findByText('Sandbox · fake · raven http://localhost:5174'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'can you get Dune (2021) in 1080p?' }))

    const link = await screen.findByRole('link', { name: 'Watch it in raven' })
    expect(link).toHaveAttribute('href', 'http://localhost:5174/movies/277?library=6')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.queryByText(/localhost:5174\/movies/)).not.toBeInTheDocument()
    expect(screen.getByText('2 tool calls: search_media, request_media')).toBeInTheDocument()
    const titles = screen.getByRole('list', { name: 'Titles' })
    expect(within(titles).getByRole('img', { name: 'Dune (2021)' })).toHaveAttribute(
      'src',
      'http://localhost:5174/api/items/277/images/logo',
    )
    expect(
      within(titles)
        .getAllByRole('link')
        .map((anchor) => anchor.textContent),
    ).toEqual(['4K Movies 4K HDR'])
    expect(screen.getByRole('region', { name: 'Verdict' })).toHaveTextContent('Meets the case')
    expect(sent).toEqual([
      { url: '/api/chat', body: { text: 'can you get Dune (2021) in 1080p?' } },
    ])
  })

  it('presses a confirmation once and picks a choice as the next message', async () => {
    const sent = serve(
      sandboxRoutes({
        '/api/chat': () =>
          new Response(
            eventStream([
              ['text', { text: 'Which one?' }],
              ['confirm', { pending_id: 5, summary: 'Replace Dune?', action: 'replace_media' }],
              [
                'choices',
                { choices: [{ label: 'Dune', value: '841', year: 1984, display: 'Dune (1984)' }] },
              ],
              ['done', {}],
            ]),
          ),
        '/api/chat/decide': () => json({ text: 'Done: replaced', settled: true, notices: [] }),
        '/api/chat/pick': () =>
          new Response(
            eventStream([
              ['text', { text: 'Got it.' }],
              ['done', {}],
            ]),
          ),
      }),
    )
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'replace dune{Enter}')

    const confirmation = await screen.findByRole('region', { name: 'Confirmation' })
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Done: replaced')).toBeInTheDocument()
    expect(within(confirmation).getByRole('button', { name: 'Confirm' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Dune (1984)' }))
    expect(await screen.findByText('Got it.')).toBeInTheDocument()
    expect(sent.map(({ url, body }) => [url, body])).toEqual([
      ['/api/chat', { text: 'replace dune' }],
      ['/api/chat/decide', { pending_id: 5, approve: true }],
      ['/api/chat/pick', { label: 'Dune', value: '841', year: 1984 }],
    ])
  })

  it('shows an approval for the admin with its buttons, and the tier can change', async () => {
    const sent = serve(
      sandboxRoutes({
        '/api/chat': () =>
          new Response(
            eventStream([
              ['notice', { kind: 'approval', text: 'Trusty wants Dune in 4K', pending_id: 8 }],
              ['text', { text: 'Asked the admin.' }],
              ['done', {}],
            ]),
          ),
        '/api/sandbox/tier': () => json({ tier: 'admin' }),
      }),
    )
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'dune in 4k{Enter}')

    const notices = await screen.findByRole('list', { name: 'Notices' })
    expect(notices).toHaveTextContent('Approval for the admin')
    expect(within(notices).getByRole('button', { name: 'Approve' })).toBeEnabled()

    await userEvent.selectOptions(screen.getByLabelText('Tier'), 'admin')
    expect(sent.at(-1)).toEqual({ url: '/api/sandbox/tier', body: { tier: 'admin' } })
  })

  it('says so when the turn cannot reach sparrow or breaks on its side', async () => {
    serve(
      sandboxRoutes({
        '/api/chat': () => new Response(eventStream([['error', { ref: 'abc123' }]])),
      }),
    )
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'hi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('ref abc123')
  })

  it('shows why a turn broke when the sandbox says', async () => {
    serve(
      sandboxRoutes({
        '/api/chat': () =>
          new Response(
            eventStream([
              ['failure', { detail: 'AuthenticationError: invalid x-api-key' }],
              ['text', { text: 'Sorry, something went wrong on my end (ref `c469d5`).' }],
              ['done', {}],
            ]),
          ),
      }),
    )
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'hi{Enter}')
    expect(await screen.findByRole('region', { name: 'Why it broke' })).toHaveTextContent(
      'AuthenticationError: invalid x-api-key',
    )
  })

  it("keeps the chat across a reload while the world is the same, and drops another world's", async () => {
    serve(
      sandboxRoutes({
        '/api/chat': () =>
          new Response(
            eventStream([
              ['text', { text: 'Hello.' }],
              ['done', {}],
            ]),
          ),
      }),
    )
    const first = renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'hi{Enter}')
    expect(await screen.findByText('Hello.')).toBeInTheDocument()
    const saved = window.localStorage.getItem(CHAT_STORAGE_KEY) ?? '{}'
    expect(JSON.parse(saved).state.owner).toBe('w1')
    first.unmount()

    // A reload: the store starts empty (which it saves) and reads the kept chat back.
    useChat.setState({ owner: null, entries: [], settled: [] })
    window.localStorage.setItem(CHAT_STORAGE_KEY, saved)
    await useChat.persist.rehydrate()
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText('Hello.')).toBeInTheDocument()
  })

  it('starts fresh when the sandbox has opened another world since', async () => {
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        state: {
          owner: 'old-world',
          entries: [{ kind: 'said', id: 0, text: 'from before' }],
          settled: [],
        },
        version: 0,
      }),
    )
    await useChat.persist.rehydrate()
    serve(sandboxRoutes())
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText(/Ask sparrow something/)).toBeInTheDocument()
    expect(screen.queryByText('from before')).not.toBeInTheDocument()
  })

  it('sends anyone signed out to rookery, coming back here after', async () => {
    const goTo = spyOn(browser, 'goTo').mockImplementation(() => undefined)
    serve({
      '/api/me': () => json({ reason: 'signed_out', sign_in: 'https://rookery.test/login' }, 401),
    })
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText('Sending you to sign in…')).toBeInTheDocument()
    expect(goTo).toHaveBeenCalledWith(
      `https://rookery.test/login?return_to=${encodeURIComponent(window.location.href)}`,
    )
  })

  it('has no sandbox controls on the real server, and tells an unlinked user whom to ask', async () => {
    serve({ '/api/me': () => json({ ...FRIEND, tier: 'unlinked' }) })
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText(/doesn't have access to this server yet/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sandbox' })).not.toBeInTheDocument()
  })
})
