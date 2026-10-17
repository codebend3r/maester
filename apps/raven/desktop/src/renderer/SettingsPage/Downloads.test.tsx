import { describe, expect, it } from 'bun:test'
import { formatBytes } from '@raven/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DL_1, DL_2, downloadsMain, SPACE, viewOf } from '@/renderer/test/downloadFakes'
import { renderDesktop } from '@/renderer/test/render'
import { sentOfType } from '@/renderer/test/serverFakes'

const TWO = [viewOf({ downloadId: DL_1 }), viewOf({ downloadId: DL_2, label: 'S01E02 Half Loop' })]

const QUESTION = `Delete all downloads? ${formatBytes(SPACE.used)} will be freed.`

const renderSection = async (options: Parameters<typeof downloadsMain>[0] = {}) => {
  const main = downloadsMain(options)
  const rendered = renderDesktop({ client: main.client, route: '/settings' })
  const section = await screen.findByRole('region', { name: 'Downloads' })
  return { ...main, ...rendered, section }
}

describe('Settings, Downloads', () => {
  it('sits below Servers', async () => {
    const { section } = await renderSection()
    const servers = screen.getByRole('region', { name: 'Servers' })
    expect(servers.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('switches Delete once watched by default', async () => {
    const { section, client } = await renderSection({ autoDeleteDefault: false })
    const toggle = await within(section).findByRole('switch', {
      name: 'Delete once watched by default',
    })
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    expect(sentOfType({ client, type: 'setDownloadDefaults' })).toEqual([
      { type: 'setDownloadDefaults', autoDelete: true },
    ])
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it("starts the switch at main's default", async () => {
    const { section } = await renderSection({ autoDeleteDefault: true })
    expect(
      await within(section).findByRole('switch', { name: 'Delete once watched by default' }),
    ).toBeChecked()
  })

  it('asks before it deletes every download, and Cancel sends nothing', async () => {
    const { section, client } = await renderSection({ downloads: TWO })
    const deleteAll = within(section).getByRole('button', { name: 'Delete all downloads' })
    await waitFor(() => expect(deleteAll).toBeEnabled())
    await userEvent.click(deleteAll)
    expect(within(section).getByText(QUESTION)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Delete all' })).toHaveAccessibleDescription(
      QUESTION,
    )
    const cancel = within(section).getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(cancel).toHaveFocus())
    await userEvent.click(cancel)
    expect(within(section).queryByText(QUESTION)).toBeNull()
    expect(within(section).getByRole('button', { name: 'Delete all downloads' })).toHaveFocus()
    expect(sentOfType({ client, type: 'deleteAllDownloads' })).toEqual([])
  })

  it('deletes every download once asked', async () => {
    const { section, client } = await renderSection({ downloads: TWO })
    const deleteAll = within(section).getByRole('button', { name: 'Delete all downloads' })
    await waitFor(() => expect(deleteAll).toBeEnabled())
    await userEvent.click(deleteAll)
    await userEvent.click(within(section).getByRole('button', { name: 'Delete all' }))
    expect(sentOfType({ client, type: 'deleteAllDownloads' })).toEqual([
      { type: 'deleteAllDownloads' },
    ])
    await waitFor(() =>
      expect(within(section).getByRole('button', { name: 'Delete all downloads' })).toBeDisabled(),
    )
    expect(within(section).getByRole('heading', { name: 'Downloads' })).toHaveFocus()
  })

  it('holds Delete all downloads while there are none', async () => {
    const { section } = await renderSection({ downloads: [] })
    await within(section).findByRole('switch', { name: 'Delete once watched by default' })
    expect(within(section).getByRole('button', { name: 'Delete all downloads' })).toBeDisabled()
  })

  it('says where downloads are kept and shows the folder in Finder', async () => {
    const { section, client } = await renderSection()
    expect(
      within(section).getByText("Downloads are kept in raven player's data folder"),
    ).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Show in Finder' }))
    expect(sentOfType({ client, type: 'showDownloadsFolder' })).toEqual([
      { type: 'showDownloadsFolder' },
    ])
  })
})
