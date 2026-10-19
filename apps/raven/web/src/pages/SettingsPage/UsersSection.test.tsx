import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Account, ApiError, AUTH_REFUSALS, MEMBER_STATUSES } from '@raven/core'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import { UsersSection } from '@/pages/SettingsPage/UsersSection'
import { fakeAccount } from '@/test/authClient'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const OWNER = fakeAccount({ email: 'owner@example.com', isOwner: true })
const WAITING_PAT = fakeAccount({
  id: '1d5b9c1e-6f55-4c53-8d51-0a8d2f6f0a01',
  email: 'pat@example.com',
  status: MEMBER_STATUSES.pending,
})
const WAITING_SAM = fakeAccount({
  id: '1d5b9c1e-6f55-4c53-8d51-0a8d2f6f0a02',
  email: 'sam@example.com',
  status: MEMBER_STATUSES.pending,
})
const MEMBER_LEE = fakeAccount({
  id: '1d5b9c1e-6f55-4c53-8d51-0a8d2f6f0a03',
  email: 'lee@example.com',
})
const GONE_KAI = fakeAccount({
  id: '1d5b9c1e-6f55-4c53-8d51-0a8d2f6f0a04',
  email: 'kai@example.com',
  status: MEMBER_STATUSES.revoked,
})
const EVERYONE = [OWNER, WAITING_PAT, WAITING_SAM, MEMBER_LEE, GONE_KAI]

const refused = ({ reason }: { reason: (typeof AUTH_REFUSALS)[keyof typeof AUTH_REFUSALS] }) =>
  new ApiError({ status: 403, message: 'Refused', refusal: { reason, message: 'Refused' } })

const tab = (name: RegExp) => screen.getByRole('tab', { name })
const rowOf = (email: string) => {
  const row = within(screen.getByRole('tabpanel'))
    .getAllByRole('listitem')
    .find((each) => within(each).queryByText(email) !== null)
  if (!row) throw new Error(`No row for ${email}`)
  return row
}
const emailsShown = () =>
  within(screen.getByRole('tabpanel'))
    .queryAllByRole('listitem')
    .map((row) => within(row).getByText(/@example\.com$/).textContent)

describe('UsersSection', () => {
  const listMembers = spyOn(api, 'listMembers')
  const setMemberStatus = spyOn(api, 'setMemberStatus')
  const server: { members: Account[] } = { members: EVERYONE }

  const renderUsers = () => renderWithProviders({ ui: <UsersSection userId={OWNER.id} /> })

  beforeEach(() => {
    server.members = EVERYONE
    listMembers.mockImplementation(async () => server.members)
    setMemberStatus.mockImplementation(async ({ id, change }) => {
      const current = server.members.find((member) => member.id === id) ?? OWNER
      const changed = { ...current, status: change.status }
      server.members = server.members.map((member) => (member.id === id ? changed : member))
      return changed
    })
  })

  afterEach(() => {
    cleanup()
    listMembers.mockReset()
    setMemberStatus.mockReset()
  })

  describe('who sees it', () => {
    it('is shown to the owner under a Users heading', async () => {
      renderUsers()

      expect(await screen.findByRole('heading', { level: 2, name: 'Users' })).toBeVisible()
    })

    it('goes away when the server says the account is not the owner', async () => {
      listMembers.mockRejectedValue(refused({ reason: AUTH_REFUSALS.notOwner }))
      renderUsers()

      await waitFor(() => expect(listMembers).toHaveBeenCalled())
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Users' })).toBeNull())
    })

    it('says why the list could not be read, and keeps the section, for any other failure', async () => {
      listMembers.mockRejectedValue(new Error('The server did not answer'))
      renderUsers()

      expect(await screen.findByRole('alert')).toHaveTextContent('The server did not answer')
      expect(screen.getByRole('heading', { name: 'Users' })).toBeVisible()
    })

    it('keeps the list under the owner who asked for it', async () => {
      const { client } = renderUsers()

      await screen.findByRole('tablist')
      const cached: unknown = client.getQueryData(queryKeys.members(OWNER.id))
      expect(cached).toEqual(EVERYONE)
    })
  })

  describe('the tabs', () => {
    it('has Pending, Approved and Removed, with Pending first and chosen', async () => {
      renderUsers()

      const tabs = await screen.findAllByRole('tab')
      expect(tabs.map((each) => each.textContent?.replace(/\d+$/, ''))).toEqual([
        'Pending',
        'Approved',
        'Removed',
      ])
      expect(tab(/^Pending/)).toHaveAttribute('aria-selected', 'true')
      expect(tab(/^Approved/)).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByRole('tablist', { name: 'Accounts' })).toBeVisible()
    })

    it('counts each tab', async () => {
      renderUsers()

      await screen.findByRole('tablist')
      expect(within(tab(/^Pending/)).getByText('2')).toBeVisible()
      expect(within(tab(/^Approved/)).getByText('2')).toBeVisible()
      expect(within(tab(/^Removed/)).getByText('1')).toBeVisible()
    })

    it('lists the pending accounts first, then the approved, then the removed', async () => {
      const user = userEvent.setup()
      renderUsers()

      await screen.findByRole('tablist')
      expect(emailsShown()).toEqual(['pat@example.com', 'sam@example.com'])
      await user.click(tab(/^Approved/))
      expect(emailsShown()).toEqual(['owner@example.com', 'lee@example.com'])
      await user.click(tab(/^Removed/))
      expect(emailsShown()).toEqual(['kai@example.com'])
    })

    it('ties the panel to the tab that names it', async () => {
      const user = userEvent.setup()
      renderUsers()

      await screen.findByRole('tablist')
      expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/^Pending/)
      await user.click(tab(/^Removed/))
      expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/^Removed/)
    })

    it('moves between tabs with the arrow keys, and only the chosen one is in the tab order', async () => {
      const user = userEvent.setup()
      renderUsers()

      await screen.findByRole('tablist')
      expect(tab(/^Approved/)).toHaveAttribute('tabindex', '-1')
      tab(/^Pending/).focus()
      await user.keyboard('{ArrowRight}')
      expect(tab(/^Approved/)).toHaveFocus()
      expect(tab(/^Approved/)).toHaveAttribute('aria-selected', 'true')
      await user.keyboard('{ArrowLeft}{ArrowLeft}')
      expect(tab(/^Removed/)).toHaveFocus()
      expect(emailsShown()).toEqual(['kai@example.com'])
    })

    it('says so when a tab has nobody', async () => {
      const user = userEvent.setup()
      server.members = [OWNER]
      renderUsers()

      await screen.findByRole('tablist')
      expect(screen.getByText('No one is waiting for approval.')).toBeVisible()
      await user.click(tab(/^Removed/))
      expect(screen.getByText('No one has been removed.')).toBeVisible()
      await user.click(tab(/^Approved/))
      expect(screen.queryByText(/^No one/)).toBeNull()
    })
  })

  describe('what each row offers', () => {
    it('lets a pending account be approved or removed', async () => {
      renderUsers()

      await screen.findByRole('tablist')
      const row = within(rowOf('pat@example.com'))
      expect(row.getByRole('button', { name: /^Approve/ })).toBeEnabled()
      expect(row.getByRole('button', { name: /^Remove access/ })).toBeEnabled()
    })

    it('lets an approved account be removed, and not approved again', async () => {
      const user = userEvent.setup()
      renderUsers()

      await user.click(await screen.findByRole('tab', { name: /^Approved/ }))
      const row = within(rowOf('lee@example.com'))
      expect(row.getByRole('button', { name: /^Remove access/ })).toBeEnabled()
      expect(row.queryByRole('button', { name: /^Approve/ })).toBeNull()
    })

    it('lets a removed account be approved again, and not removed twice', async () => {
      const user = userEvent.setup()
      renderUsers()

      await user.click(await screen.findByRole('tab', { name: /^Removed/ }))
      const row = within(rowOf('kai@example.com'))
      expect(row.getByRole('button', { name: /^Approve/ })).toBeEnabled()
      expect(row.queryByRole('button', { name: /^Remove access/ })).toBeNull()
    })

    it("gives the owner's own row no buttons, and says whose it is", async () => {
      const user = userEvent.setup()
      renderUsers()

      await user.click(await screen.findByRole('tab', { name: /^Approved/ }))
      const row = within(rowOf('owner@example.com'))
      expect(row.queryByRole('button')).toBeNull()
      expect(row.getByText('Owner')).toBeVisible()
    })

    it('names the account in each button, so a screen reader can tell the rows apart', async () => {
      renderUsers()

      await screen.findByRole('tablist')
      expect(screen.getByRole('button', { name: 'Approve pat@example.com' })).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'Remove access for sam@example.com' }),
      ).toBeVisible()
    })
  })

  describe('Approve', () => {
    it('moves the account to Approved and reads the list again', async () => {
      const user = userEvent.setup()
      renderUsers()

      await user.click(await screen.findByRole('button', { name: 'Approve pat@example.com' }))

      await waitFor(() => expect(emailsShown()).toEqual(['sam@example.com']))
      expect(setMemberStatus).toHaveBeenCalledWith({
        id: WAITING_PAT.id,
        change: { status: MEMBER_STATUSES.approved },
      })
      expect(listMembers).toHaveBeenCalledTimes(2)
      expect(within(tab(/^Pending/)).getByText('1')).toBeVisible()
      expect(within(tab(/^Approved/)).getByText('3')).toBeVisible()
      await user.click(tab(/^Approved/))
      expect(emailsShown()).toContain('pat@example.com')
    })

    it('brings a removed account back without asking first', async () => {
      const user = userEvent.setup()
      renderUsers()

      await user.click(await screen.findByRole('tab', { name: /^Removed/ }))
      await user.click(screen.getByRole('button', { name: 'Approve kai@example.com' }))

      await waitFor(() => expect(screen.getByText('No one has been removed.')).toBeVisible())
      expect(setMemberStatus).toHaveBeenCalledWith({
        id: GONE_KAI.id,
        change: { status: MEMBER_STATUSES.approved },
      })
    })

    it('keeps the buttons off while the change is on its way', async () => {
      const user = userEvent.setup()
      const change = held<Account>()
      setMemberStatus.mockImplementation(() => change.promise)
      renderUsers()

      await user.click(await screen.findByRole('button', { name: 'Approve pat@example.com' }))

      expect(screen.getByRole('button', { name: 'Approve sam@example.com' })).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'Remove access for pat@example.com' }),
      ).toBeDisabled()

      await act(async () => change.answer({ ...WAITING_PAT, status: MEMBER_STATUSES.approved }))
      // A failed toBeEnabled prints the whole element, which takes seconds; a boolean prints at once.
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Approve sam@example.com' }).hasAttribute('disabled'),
        ).toBe(false),
      )
      expect(screen.getByRole('button', { name: 'Approve sam@example.com' })).toBeEnabled()
    })

    it('says what went wrong, and keeps the row where it was', async () => {
      const user = userEvent.setup()
      setMemberStatus.mockRejectedValue(new Error('Supabase did not answer'))
      renderUsers()

      await user.click(await screen.findByRole('button', { name: 'Approve pat@example.com' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not change access: Supabase did not answer',
      )
      expect(emailsShown()).toEqual(['pat@example.com', 'sam@example.com'])
      expect(screen.getByRole('button', { name: 'Approve pat@example.com' })).toBeEnabled()
      expect(listMembers).toHaveBeenCalledTimes(1)
    })

    it('drops the message once a later change works', async () => {
      const user = userEvent.setup()
      setMemberStatus.mockRejectedValueOnce(new Error('Supabase did not answer'))
      renderUsers()

      await user.click(await screen.findByRole('button', { name: 'Approve pat@example.com' }))
      await screen.findByRole('alert')
      await user.click(screen.getByRole('button', { name: 'Approve pat@example.com' }))

      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })
  })

  describe('Remove access', () => {
    const askAboutSam = async ({ user }: { user: ReturnType<typeof userEvent.setup> }) => {
      await user.click(
        await screen.findByRole('button', { name: 'Remove access for sam@example.com' }),
      )
    }

    it('asks first, and changes nothing until it is confirmed', async () => {
      const user = userEvent.setup()
      renderUsers()

      await askAboutSam({ user })

      const row = within(rowOf('sam@example.com'))
      expect(row.getByText('Remove access for this account?')).toBeVisible()
      expect(
        row.getByRole('button', { name: 'Yes, remove access for sam@example.com' }),
      ).toBeVisible()
      expect(row.queryByRole('button', { name: /^Approve/ })).toBeNull()
      expect(setMemberStatus).not.toHaveBeenCalled()
    })

    it('asks about one account at a time and leaves the others alone', async () => {
      const user = userEvent.setup()
      renderUsers()

      await askAboutSam({ user })

      const other = within(rowOf('pat@example.com'))
      expect(other.getByRole('button', { name: 'Approve pat@example.com' })).toBeEnabled()
      expect(other.queryByText('Remove access for this account?')).toBeNull()
    })

    it('moves focus to Cancel, and puts it back on Remove access when cancelled', async () => {
      const user = userEvent.setup()
      renderUsers()

      await askAboutSam({ user })
      const cancel = screen.getByRole('button', { name: 'Cancel removing sam@example.com' })
      expect(cancel).toHaveFocus()
      await user.click(cancel)

      expect(setMemberStatus).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', { name: 'Remove access for sam@example.com' }),
      ).toHaveFocus()
      expect(screen.queryByText('Remove access for this account?')).toBeNull()
    })

    it('removes the account once confirmed, and moves it to Removed', async () => {
      const user = userEvent.setup()
      renderUsers()

      await askAboutSam({ user })
      await user.click(
        screen.getByRole('button', { name: 'Yes, remove access for sam@example.com' }),
      )

      await waitFor(() => expect(emailsShown()).toEqual(['pat@example.com']))
      expect(setMemberStatus).toHaveBeenCalledWith({
        id: WAITING_SAM.id,
        change: { status: MEMBER_STATUSES.revoked },
      })
      await user.click(tab(/^Removed/))
      expect(emailsShown()).toEqual(['sam@example.com', 'kai@example.com'])
    })

    it('says what went wrong when the removal fails, and asks no more', async () => {
      const user = userEvent.setup()
      setMemberStatus.mockRejectedValue(new Error('Supabase did not answer'))
      renderUsers()

      await askAboutSam({ user })
      await user.click(
        screen.getByRole('button', { name: 'Yes, remove access for sam@example.com' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('Supabase did not answer')
      expect(emailsShown()).toEqual(['pat@example.com', 'sam@example.com'])
      expect(screen.queryByText('Remove access for this account?')).toBeNull()
      expect(
        screen.getByRole('button', { name: 'Remove access for sam@example.com' }),
      ).toBeEnabled()
    })
  })
})
