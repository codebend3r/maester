import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ROUTES, TIERS } from '@/lib/api'
import { browser } from '@/lib/browser'
import { ENTRY_KINDS } from '@/lib/entries'
import { CHAT_EVENTS, NOTICE_KINDS } from '@/lib/events'
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

const FRIEND = { user: { id: 'eval-user', display_name: 'Sandbox friend' }, tier: TIERS.friend }

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
  [ROUTES.me]: () => json(FRIEND),
  [ROUTES.sandbox]: () => json(SANDBOX),
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
    )
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
    const sent = serve(
      sandboxRoutes({
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
    )
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
    const sent = serve(
      sandboxRoutes({
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
      [ROUTES.chat, { text: 'replace dune' }],
      [ROUTES.decide, { pending_id: 5, approve: true }],
      [ROUTES.pick, { label: 'Dune', value: '841', year: 1984 }],
    ])
  })

  it('shows a note for the admin, with no buttons, and the tier can change', async () => {
    const sent = serve(
      sandboxRoutes({
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
    )
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
    serve(
      sandboxRoutes({
        [ROUTES.chat]: () => new Response(eventStream([[CHAT_EVENTS.error, { ref: 'abc123' }]])),
      }),
    )
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'hi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('ref abc123')
  })

  it('shows why a turn broke when the sandbox says', async () => {
    serve(
      sandboxRoutes({
        [ROUTES.chat]: () =>
          new Response(
            eventStream([
              [CHAT_EVENTS.failure, { detail: 'AuthenticationError: invalid x-api-key' }],
              [CHAT_EVENTS.text, { text: 'Sorry, something went wrong on my end (ref `c469d5`).' }],
              [CHAT_EVENTS.done, {}],
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
        [ROUTES.chat]: () =>
          new Response(
            eventStream([
              [CHAT_EVENTS.text, { text: 'Hello.' }],
              [CHAT_EVENTS.done, {}],
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
          entries: [{ kind: ENTRY_KINDS.said, id: 0, text: 'from before' }],
          settled: [],
        },
        version: 0,
      }),
    )
    await useChat.persist.rehydrate()
    serve(sandboxRoutes())
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
    serve(sandboxRoutes())
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText('How can I help?')).toBeInTheDocument()
    expect(screen.queryByText('an old answer')).not.toBeInTheDocument()
  })

  it('keeps the conversation when sparrow does not answer Start over', async () => {
    serve(
      sandboxRoutes({
        [ROUTES.chat]: () =>
          new Response(
            eventStream([
              [CHAT_EVENTS.text, { text: 'Hello.' }],
              [CHAT_EVENTS.done, {}],
            ]),
          ),
        [ROUTES.forget]: () => json({ detail: 'down' }, 503),
      }),
    )
    renderWithQueries(<ChatPage />)
    await userEvent.type(await screen.findByLabelText('Message sparrow'), 'hi{Enter}')
    expect(await screen.findByText('Hello.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(await screen.findByText(/Couldn't start over/)).toBeInTheDocument()
    expect(screen.getByText('Hello.')).toBeInTheDocument()
  })

  it('sends anyone signed out to rookery, coming back here after', async () => {
    const goTo = spyOn(browser, 'goTo').mockImplementation(() => undefined)
    serve({
      [ROUTES.me]: () => json({ reason: 'signed_out', sign_in: 'https://rookery.test/login' }, 401),
    })
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText('Sending you to sign in…')).toBeInTheDocument()
    expect(goTo).toHaveBeenCalledWith(
      `https://rookery.test/login?return_to=${encodeURIComponent(window.location.href)}`,
    )
  })

  it('has no sandbox controls on the real server, and tells an unlinked user whom to ask', async () => {
    serve({ [ROUTES.me]: () => json({ ...FRIEND, tier: TIERS.unlinked }) })
    renderWithQueries(<ChatPage />)
    expect(await screen.findByText(/doesn't have access to this server yet/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sandbox' })).not.toBeInTheDocument()
  })
})
