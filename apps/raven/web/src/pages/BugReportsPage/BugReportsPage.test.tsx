import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { ADMIN_LOCK_STATES, ApiError, BUG_REPORT_STATUSES, PLAYBACK_MODES } from '@raven/core'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { BugReportsPage } from '@/pages/BugReportsPage/BugReportsPage'
import { fakeAccount } from '@/test/authClient'
import { bugReport, playbackDiagnostics } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const secure = (isSecureContext: boolean) =>
  Object.defineProperty(window, 'isSecureContext', { value: isSecureContext, configurable: true })

describe('BugReportsPage', () => {
  const spies = {
    list: spyOn(api, 'listBugReports'),
    status: spyOn(api, 'setBugReportStatus'),
  }

  afterEach(() => {
    cleanup()
    spies.list.mockReset()
    spies.status.mockReset()
    Reflect.deleteProperty(window, 'isSecureContext')
  })

  it('lists each report with when, who, what failed and its status', async () => {
    spies.list.mockImplementation(async () => [
      bugReport({
        id: 2,
        title: 'Heat (1995)',
        summary: 'The converted video stopped.',
        reporter: { accountId: 'a1', email: 'friend@maester.test' },
        status: BUG_REPORT_STATUSES.investigating,
        diagnostics: playbackDiagnostics({
          playback: {
            modes: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
            attempts: [
              {
                mode: PLAYBACK_MODES.remux,
                message: 'The converted video stopped.',
                position: 12,
                frame: null,
                frames: null,
              },
              {
                mode: PLAYBACK_MODES.transcode,
                message: 'The converted video stopped.',
                position: 30,
                frame: null,
                frames: null,
              },
            ],
            isForced: false,
            steppedDown: null,
            settings: null,
          },
        }),
      }),
      bugReport({ id: 1 }),
    ])
    renderWithProviders({ ui: <BugReportsPage /> })

    expect(await screen.findByRole('heading', { name: 'Heat (1995)' })).toBeInTheDocument()
    expect(screen.getByText('2 reports, 1 new')).toBeInTheDocument()
    const [heat, busboys] = screen.getAllByRole('listitem')
    if (!heat || !busboys) throw new Error('two reports should be listed')
    expect(within(heat).getByText(/by friend@maester\.test/)).toBeInTheDocument()
    expect(within(heat).getByText('The converted video stopped.')).toBeInTheDocument()
    expect(within(heat).getByText('Remux, then Transcode')).toBeInTheDocument()
    expect(within(heat).getByText('Mozilla/5.0 (iPhone) Safari/605.1.15')).toBeInTheDocument()
    expect(within(heat).getByRole('combobox', { name: 'Status of report 2' })).toHaveValue(
      BUG_REPORT_STATUSES.investigating,
    )
    expect(within(busboys).getByText(/by local/)).toBeInTheDocument()
    expect(within(busboys).getByText('Nothing, it could not start')).toBeInTheDocument()
    expect(within(busboys).getByRole('combobox', { name: 'Status of report 1' })).toHaveValue(
      BUG_REPORT_STATUSES.new,
    )
  })

  it('offers the four statuses by name', async () => {
    spies.list.mockImplementation(async () => [bugReport()])
    renderWithProviders({ ui: <BugReportsPage /> })
    const select = await screen.findByRole('combobox', { name: 'Status of report 1' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['New', 'Investigating', 'Fixed', "Won't fix"])
  })

  it('says so when nothing has been reported', async () => {
    spies.list.mockImplementation(async () => [])
    renderWithProviders({ ui: <BugReportsPage /> })
    expect(await screen.findByText('Nothing has been reported')).toBeInTheDocument()
  })

  it('moves a report to the status picked, before the server answers', async () => {
    spies.list.mockImplementation(async () => [bugReport({ id: 4 })])
    const answer = Promise.withResolvers<ReturnType<typeof bugReport>>()
    spies.status.mockImplementation(() => answer.promise)
    renderWithProviders({ ui: <BugReportsPage /> })
    const select = await screen.findByRole('combobox', { name: 'Status of report 4' })

    await userEvent.selectOptions(select, 'Fixed')
    expect(spies.status).toHaveBeenCalledWith({ id: 4, status: BUG_REPORT_STATUSES.fixed })
    expect(select).toHaveValue(BUG_REPORT_STATUSES.fixed)

    const fixed = bugReport({ id: 4, status: BUG_REPORT_STATUSES.fixed })
    spies.list.mockImplementation(async () => [fixed])
    answer.resolve(fixed)
    await waitFor(() => expect(spies.list).toHaveBeenCalledTimes(2))
    expect(select).toHaveValue(BUG_REPORT_STATUSES.fixed)
  })

  it('puts the status back and says why when the server refuses it', async () => {
    spies.list.mockImplementation(async () => [bugReport()])
    spies.status.mockImplementation(async () => {
      throw new ApiError({ status: 404, message: 'No report' })
    })
    renderWithProviders({ ui: <BugReportsPage /> })
    const select = await screen.findByRole('combobox', { name: 'Status of report 1' })
    await userEvent.selectOptions(select, 'Investigating')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not change its status: No report',
    )
    expect(select).toHaveValue(BUG_REPORT_STATUSES.new)
  })

  it('copies everything the report holds as text', async () => {
    secure(true)
    const copied: string[] = []
    const write = spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
      copied.push(text)
    })
    spies.list.mockImplementation(async () => [
      bugReport({ id: 9, reporter: { accountId: 'a1', email: 'friend@maester.test' } }),
    ])
    renderWithProviders({ ui: <BugReportsPage /> })
    await userEvent.click(await screen.findByRole('button', { name: 'Copy debug info' }))
    write.mockRestore()

    expect(await screen.findByText('Debug info copied.')).toBeInTheDocument()
    const [text = ''] = copied
    expect(text).toStartWith(
      [
        'raven bug report #9',
        'Status: New',
        'Reported: 2026-10-20T12:00:00.000Z',
        'Reported by: friend@maester.test (account a1)',
        'Title: Busboys (2026)',
        "Problem: The MKV container isn't supported here.",
        'Media id: 7',
        '',
        'Diagnostics:',
      ].join('\n'),
    )
    expect(JSON.parse(text.slice(text.indexOf('{')))).toEqual(playbackDiagnostics())
  })

  it('says where to copy it from when the browser will not', async () => {
    secure(true)
    const write = spyOn(navigator.clipboard, 'writeText').mockImplementation(async () => {
      throw new Error('denied')
    })
    spies.list.mockImplementation(async () => [bugReport()])
    renderWithProviders({ ui: <BugReportsPage /> })
    await userEvent.click(await screen.findByRole('button', { name: 'Copy debug info' }))
    write.mockRestore()
    expect(
      await screen.findByText('Could not copy. Open Debug info and copy it from there.'),
    ).toBeInTheDocument()
  })

  it('shows the diagnostics as sent under Debug info', async () => {
    spies.list.mockImplementation(async () => [bugReport()])
    renderWithProviders({ ui: <BugReportsPage /> })
    await userEvent.click(await screen.findByText('Debug info'))
    expect(screen.getByText(/"userAgent": "Mozilla\/5\.0 \(iPhone\)/)).toBeVisible()
  })

  it('asks for nothing and points to Settings while the admin lock is on', () => {
    renderWithProviders({
      ui: <BugReportsPage />,
      adminLock: { state: ADMIN_LOCK_STATES.on, available: true },
    })
    expect(
      screen.getByRole('heading', { name: 'Bug reports are for the admin' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(spies.list).not.toHaveBeenCalled()
  })

  it('lists the reports for the owner of a server with accounts', async () => {
    spies.list.mockImplementation(async () => [bugReport()])
    renderWithProviders({
      ui: <BugReportsPage />,
      account: fakeAccount({ isOwner: true }),
      adminLock: null,
    })
    expect(await screen.findByRole('heading', { name: 'Busboys (2026)' })).toBeInTheDocument()
  })

  it('says reports are for the owner to a member, and asks for nothing', () => {
    renderWithProviders({ ui: <BugReportsPage />, account: fakeAccount(), adminLock: null })
    expect(
      screen.getByRole('heading', { name: 'Bug reports are for the owner' }),
    ).toBeInTheDocument()
    expect(spies.list).not.toHaveBeenCalled()
  })

  it('says when the server did not answer', async () => {
    spies.list.mockImplementation(async () => {
      throw new ApiError({ status: 500, message: 'Boom' })
    })
    renderWithProviders({ ui: <BugReportsPage /> })
    expect(await screen.findByRole('alert')).toHaveTextContent('The server did not answer: Boom')
  })
})
