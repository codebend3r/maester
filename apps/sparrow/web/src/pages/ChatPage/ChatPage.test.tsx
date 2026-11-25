import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '@supabase/supabase-js'
import { HEADERS } from '@shared/http'
import { AUTH_CONFIG_STATES, REFUSALS, ROUTES, TIERS } from '@/lib/api'
import type { AuthClient } from '@/lib/authClient'
import { ENTRY_KINDS } from '@/lib/entries'
import { CHAT_EVENTS, NOTICE_KINDS } from '@/lib/events'
import { ChatPage } from '@/pages/ChatPage/ChatPage'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { CHAT_STORAGE_KEY, useChat } from '@/stores/chat'
import { eventStream, renderWithQueries } from '@/test/render'

type Sent = { url: string; body: unknown }

type Asked = { url: string; bearer: string | null }

type Routes = Record<string, (bearer: string | null) => Response>

type Serving = { routes: Routes; asked?: Asked[] }

type Credentials = { email: string; password: string }

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

const FRIEND = { user: { id: 'eval-user', email: 'eval@sparrow.test' }, tier: TIERS.friend }

const READY_CONFIG = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'https://supabase.test',
  publishableKey: 'sb_publishable_test',
  webUrl: 'https://raven.test',
  cookieName: 'maester-auth',
}

const SESSION: Session = {
  access_token: 'token-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: 'account-1',
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-11-24T00:00:00Z',
  },
}

const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

const bearerOf = (init?: RequestInit): string | null =>
  new Headers(init?.headers).get(HEADERS.authorization)

/** Answers each route from `routes`, and records what was posted and every bearer sent. */
const serve = ({ routes, asked = [] }: Serving) => {
  const sent: Sent[] = []
  const answer = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    const bearer = bearerOf(init)
    asked.push({ url, bearer })
    if (typeof init?.body === 'string') sent.push({ url, body: JSON.parse(init.body) })
    return routes[url]?.(bearer) ?? json({ detail: 'Not Found' }, 404)
  }
  // Bun's fetch type carries `preconnect` too.
  spyOn(globalThis, 'fetch').mockImplementation(Object.assign(answer, { preconnect: () => {} }))
  return sent
}

/** A Supabase client that lets `SESSION` in with any password, and records each sign-in. */
const fakeAuthClient = (signedIn: Credentials[]): AuthClient => ({
  signInWithPassword: async (credentials) => {
    if ('email' in credentials) signedIn.push(credentials)
    return { data: { user: SESSION.user, session: SESSION }, error: null }
  },
  signOut: async () => ({ error: null }),
  getSession: async () => ({ data: { session: null }, error: null }),
  onAuthStateChange: () => ({
    data: { subscription: { id: 'fake', callback: () => {}, unsubscribe: () => {} } },
  }),
})

/** The auth store as it stands once Supabase's client has loaded and found no session kept. */
const startedWith = (client: AuthClient) =>
  useAuthSession.setState({
    clientLoad: Promise.resolve(client),
    session: null,
    status: AUTH_SESSION_STATUSES.ready,
  })

const sandboxRoutes = (extra: Routes = {}) => ({
  [ROUTES.me]: () => json(FRIEND),
  [ROUTES.sandbox]: () => json(SANDBOX),
  ...extra,
})

describe('ChatPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useChat.setState({ owner: null, entries: [], settled: [], isBusy: false })
    useAuthSession.setState({
      clientLoad: null,
      session: null,
      status: AUTH_SESSION_STATUSES.booting,
    })
  })

  it('sends a case message and shows the reply, its tools and the verdict', async () => {
    const sent = serve({
      routes: sandboxRoutes({
        [ROUTES.chat]: () =>
          new Response(
            eventStream([
              [
                CHAT_EVENTS.tool,
                { name: 'search_media', input: { query: 'Dune' }, ok: true, result: '[]' },
              ],
              [
                CHAT_EVENTS.tool,
                { name: 'request_media', input: { tmdb_id: 438631 }, ok: true, result: 'ok' },
              ],
              [
                CHAT_EVENTS.titles,
                {
                  titles: [
                    {
                      key: 'raven:movie:277',
                      title: 'Dune',
                      year: 2021,
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
                CHAT_EVENTS.text,
                {
                  text: 'Requested Dune (2021) in 1080p. [Watch it in raven](http://localhost:5174/movies/277?library=6)',
                },
              ],
              [CHAT_EVENTS.done, {}],
            ]),
          ),
      }),
    })
    renderWithQueries(<ChatPage />)

    expect(await screen.findByText('raven · localhost:5174')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'can you get Dune (2021) in 1080p?' }))

    const link = await screen.findByRole('link', { name: 'Watch it in raven' })
    expect(link).toHaveAttribute('href', 'http://localhost:5174/movies/277?library=6')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.queryByText(/localhost:5174\/movies/)).not.toBeInTheDocument()
    const tools = screen.getByRole('list', { name: 'Tool calls' })
    expect(within(tools).getByText('✓ search_media("Dune")')).toBeInTheDocument()
    expect(within(tools).getByText('✓ request_media(438631)')).toBeInTheDocument()
    const titles = screen.getByRole('list', { name: 'Titles' })
    expect(within(titles).getByText('Dune')).toBeInTheDocument()
    expect(within(titles).getByText('2021')).toBeInTheDocument()
    expect(
      within(titles)
        .getAllByRole('link')
        .map((anchor) => anchor.textContent),
    ).toEqual(['4K Movies 4K HDR'])
    expect(screen.getByRole('region', { name: 'Verdict' })).toHaveTextContent('Meets the case')
    expect(sent).toEqual([
      { url: ROUTES.chat, body: { text: 'can you get Dune (2021) in 1080p?' } },
    ])
  })

  it('shows the model and the tokens left, read again after each turn, and ＋ starts over', async () => {
    const used = [15_750]
    const sent = serve({
      routes: sandboxRoutes({
        [ROUTES.usage]: () =>
          json({ model: 'claude-sonnet-5-5', tokens_used: used[0], token_budget: 200_000 }),
        [ROUTES.chat]: () => {
          used[0] = 190_000
          return new Response(
            eventStream([
              [CHAT_EVENTS.text, { text: 'Hello.' }],
              [CHAT_EVENTS.done, {}],
            ]),
          )
        },
        [ROUTES.forget]: () => json({ text: 'Forgotten.' }),
      }),
    })
    renderWithQueries(<ChatPage />)

    expect(await screen.findByText('claude-sonnet-5-5')).toBeInTheDocument()
    expect(await screen.findByText('184,250')).toBeInTheDocument()
    expect(screen.getByText('/ 200,000 tokens left')).toBeInTheDocument()

    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'hi{Enter}')
    expect(await screen.findByText('Hello.')).toBeInTheDocument()
    expect(await screen.findByText('10,000')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(await screen.findByText('How can I help?')).toBeInTheDocument()
    expect(sent.at(-1)).toEqual({ url: ROUTES.forget, body: {} })
  })

  it('presses a confirmation once and picks a choice as the next message', async () => {
    const sent = serve({
      routes: sandboxRoutes({
        [ROUTES.chat]: () =>
          new Response(
            eventStream([
              [CHAT_EVENTS.text, { text: 'Which one?' }],
              [
                CHAT_EVENTS.confirm,
                { pending_id: 5, summary: 'Replace Dune?', action: 'replace_media' },
              ],
              [
                'choices',
                { choices: [{ label: 'Dune', value: '841', year: 1984, display: 'Dune (1984)' }] },
              ],
              [CHAT_EVENTS.done, {}],
            ]),
          ),
        [ROUTES.decide]: () => json({ text: 'Done: replaced', settled: true, notices: [] }),
        [ROUTES.pick]: () =>
          new Response(
            eventStream([
              [CHAT_EVENTS.text, { text: 'Got it.' }],
              [CHAT_EVENTS.done, {}],
            ]),
          ),
      }),
    })
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'replace dune{Enter}')

    const confirmation = await screen.findByRole('region', { name: 'Confirmation' })
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Done: replaced')).toBeInTheDocument()
    expect(within(confirmation).getByRole('button', { name: 'Confirm' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Dune (1984)' }))
    expect(await screen.findByText('Got it.')).toBeInTheDocument()
    expect(sent.map(({ url, body }) => [url, body])).toEqual([
      [ROUTES.chat, { text: 'replace dune' }],
      [ROUTES.decide, { pending_id: 5, approve: true }],
      [ROUTES.pick, { label: 'Dune', value: '841', year: 1984 }],
    ])
  })

  it('shows a note for the admin, with no buttons, and the tier can change', async () => {
    const sent = serve({
      routes: sandboxRoutes({
        [ROUTES.chat]: () =>
          new Response(
            eventStream([
              [CHAT_EVENTS.notice, { kind: NOTICE_KINDS.adminPost, text: 'Trusty reported Dune' }],
              [CHAT_EVENTS.text, { text: 'Told the admin.' }],
              [CHAT_EVENTS.done, {}],
            ]),
          ),
        [ROUTES.sandboxTier]: () => json({ tier: TIERS.admin }),
      }),
    })
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'dune skips{Enter}')

    const notices = await screen.findByRole('list', { name: 'Notices' })
    expect(notices).toHaveTextContent('To the admin')
    expect(notices).toHaveTextContent('Trusty reported Dune')
    expect(within(notices).queryByRole('button')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Tier'), 'admin')
    expect(sent.at(-1)).toEqual({ url: ROUTES.sandboxTier, body: { tier: TIERS.admin } })
  })

  it('says so when the turn cannot reach sparrow or breaks on its side', async () => {
    serve({
      routes: sandboxRoutes({
        [ROUTES.chat]: () => new Response(eventStream([[CHAT_EVENTS.error, { ref: 'abc123' }]])),
      }),
    })
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'hi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('ref abc123')
  })

  it('shows why a turn broke when the sandbox says', async () => {
    serve({
      routes: sandboxRoutes({
        [ROUTES.chat]: () =>
          new Response(
            eventStream([
              [CHAT_EVENTS.failure, { detail: 'AuthenticationError: invalid x-api-key' }],
              [CHAT_EVENTS.text, { text: 'Sorry, something went wrong on my end (ref `c469d5`).' }],
              [CHAT_EVENTS.done, {}],
            ]),
          ),
      }),
    })
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'hi{Enter}')
    expect(await screen.findByRole('region', { name: 'Why it broke' })).toHaveTextContent(
      'AuthenticationError: invalid x-api-key',
    )
  })

  it("keeps the chat across a reload while the world is the same, and drops another world's", async () => {
    serve({
      routes: sandboxRoutes({
        [ROUTES.chat]: () =>
          new Response(
            eventStream([
              [CHAT_EVENTS.text, { text: 'Hello.' }],
              [CHAT_EVENTS.done, {}],
            ]),
          ),
      }),
    })
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
          entries: [{ kind: ENTRY_KINDS.said, id: 0, text: 'from before' }],
          settled: [],
        },
        version: 0,
      }),
    )
    await useChat.persist.rehydrate()
    serve({ routes: sandboxRoutes() })
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText('How can I help?')).toBeInTheDocument()
    expect(screen.queryByText('from before')).not.toBeInTheDocument()
  })

  it('starts fresh from a chat saved before replies kept their events', async () => {
    // The chat raw as the page saved it before replies kept their events.
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        state: {
          owner: 'w1',
          entries: [
            { kind: 'said', id: 0, text: 'from before' },
            {
              kind: 'reply',
              id: 1,
              state: 'done',
              chunks: ['an old answer'],
              tools: [],
              confirmations: [],
              choices: [],
              notices: [{ kind: 'approval', text: 'Dune in 4K?', pendingId: 3, to: null }],
              titles: [],
              failure: null,
              cause: null,
              expected: null,
            },
          ],
          settled: [3],
        },
        version: 0,
      }),
    )
    await useChat.persist.rehydrate()
    expect(useChat.getState().entries).toEqual([])
    serve({ routes: sandboxRoutes() })
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText('How can I help?')).toBeInTheDocument()
    expect(screen.queryByText('an old answer')).not.toBeInTheDocument()
  })

  it('keeps the conversation when sparrow does not answer Start over', async () => {
    serve({
      routes: sandboxRoutes({
        [ROUTES.chat]: () =>
          new Response(
            eventStream([
              [CHAT_EVENTS.text, { text: 'Hello.' }],
              [CHAT_EVENTS.done, {}],
            ]),
          ),
        [ROUTES.forget]: () => json({ detail: 'down' }, 503),
      }),
    })
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'hi{Enter}')
    expect(await screen.findByText('Hello.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(await screen.findByText(/Couldn't start over/)).toBeInTheDocument()
    expect(screen.getByText('Hello.')).toBeInTheDocument()
  })

  it('signs a signed-out visitor in with raven, then asks sparrow with the bearer', async () => {
    const signedIn: Credentials[] = []
    startedWith(fakeAuthClient(signedIn))
    const asked: Asked[] = []
    serve({
      routes: {
        [ROUTES.me]: (bearer) =>
          bearer === `Bearer ${SESSION.access_token}`
            ? json(FRIEND)
            : json({ reason: REFUSALS.signedOut }, 401),
        [ROUTES.authConfig]: () => json(READY_CONFIG),
      },
      asked,
    })
    renderWithQueries(<ChatPage />)

    await userEvent.type(await screen.findByLabelText('Email'), 'friend@raven.test')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByLabelText('Message sparrow')).toBeInTheDocument()
    expect(signedIn).toEqual([{ email: 'friend@raven.test', password: 'hunter2' }])
    expect(asked.filter(({ url }) => url === ROUTES.me).map(({ bearer }) => bearer)).toEqual([
      null,
      `Bearer ${SESSION.access_token}`,
    ])
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('asks for both fields before trying Supabase', async () => {
    const signedIn: Credentials[] = []
    startedWith(fakeAuthClient(signedIn))
    serve({
      routes: {
        [ROUTES.me]: () => json({ reason: REFUSALS.signedOut }, 401),
        [ROUTES.authConfig]: () => json(READY_CONFIG),
      },
    })
    renderWithQueries(<ChatPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email and password.')
    expect(signedIn).toEqual([])
  })

  it("says sign-in isn't available when raven's accounts are off or out of reach", async () => {
    serve({
      routes: {
        [ROUTES.me]: () => json({ reason: REFUSALS.signedOut }, 401),
        [ROUTES.authConfig]: () => json({ reason: REFUSALS.signInUnavailable }, 503),
      },
    })
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText(/Sign-in isn't available right now/)).toBeInTheDocument()
  })

  it("has no sandbox controls on the real server, and tells someone raven hasn't approved whom to ask", async () => {
    serve({ routes: { [ROUTES.me]: () => json({ reason: REFUSALS.notApproved }, 403) } })
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText(/raven account isn't approved yet/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sandbox' })).not.toBeInTheDocument()
  })

  it('runs the sandbox with no sign-in and no bearer', async () => {
    const asked: Asked[] = []
    serve({ routes: sandboxRoutes(), asked })
    renderWithQueries(<ChatPage />)
    expect(await screen.findByLabelText('Message sparrow')).toBeInTheDocument()
    expect(asked.every(({ bearer }) => bearer === null)).toBe(true)
    expect(asked.some(({ url }) => url === ROUTES.authConfig)).toBe(false)
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })
})
