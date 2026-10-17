import { describe, expect, it } from 'bun:test'
import { DEFAULT_OUTPUT_SETTINGS, type OutputSettings } from '@raven/core'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeClient, renderDesktop } from '@/renderer/test/render'
import type { AudioDevice, DesktopRequest } from '@/shared/protocol'

const DEVICES: AudioDevice[] = [
  { name: 'auto', description: 'Autoselect device' },
  { name: 'coreaudio/Den', description: 'Den receiver' },
]

/** Main as the page sees it: the last written settings come back on the next read. */
const mainWith = ({
  initial = DEFAULT_OUTPUT_SETTINGS,
  devices = DEVICES,
  isEngineReady = true,
  refusal = null,
  isRejecting = false,
  refuseOnce = null,
}: {
  initial?: OutputSettings
  devices?: AudioDevice[]
  isEngineReady?: boolean
  refusal?: string | null
  isRejecting?: boolean
  refuseOnce?: string | null
} = {}) => {
  const stored = { output: initial }
  const writes: OutputSettings[] = []
  const client = fakeClient({
    request: async (asked: DesktopRequest) => {
      if (asked.type === 'readOutput') {
        return { type: 'output', output: stored.output, devices, isEngineReady }
      }
      if (asked.type === 'writeOutput') {
        writes.push(asked.output)
        if (isRejecting) throw new Error('port closed')
        if (refusal !== null) return { type: 'refused', message: refusal }
        if (refuseOnce !== null && writes.length === 1)
          return { type: 'refused', message: refuseOnce }
        stored.output = asked.output
        return { type: 'done' }
      }
      return { type: 'recents', recents: [] }
    },
  })
  return { client, writes }
}

const renderSection = async (options: Parameters<typeof mainWith>[0] = {}) => {
  const main = mainWith(options)
  renderDesktop({ client: main.client, route: '/settings' })
  const section = await screen.findByRole('region', { name: 'This computer' })
  await within(section).findByRole('radio', { name: 'Speakers or TV (PCM, up to 7.1)' })
  return { ...main, section }
}

describe('ThisComputer', () => {
  it('shows the stored profile and offers the system default and each device once', async () => {
    const { section } = await renderSection()
    expect(
      within(section).getByRole('radio', { name: 'Speakers or TV (PCM, up to 7.1)' }),
    ).toBeChecked()
    const select = within(section).getByRole('combobox', { name: 'Output device' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['System default', 'Den receiver'])
  })

  it('groups the profiles in a fieldset', async () => {
    const { section } = await renderSection()
    const group = within(section).getByRole('group', { name: 'Sound output' })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
  })

  it('hides the formats and the spatial toggle for PCM', async () => {
    const { section } = await renderSection()
    expect(
      within(section).queryByRole('group', { name: 'Formats your receiver decodes' }),
    ).toBeNull()
    expect(within(section).queryByRole('checkbox')).toBeNull()
  })

  it('saves passthrough, shows the formats checked, and explains the volume', async () => {
    const { section, writes } = await renderSection()
    await userEvent.click(within(section).getByRole('radio', { name: 'Receiver passthrough' }))
    await waitFor(() =>
      expect(writes).toEqual([{ ...DEFAULT_OUTPUT_SETTINGS, profile: 'passthrough' }]),
    )
    const formats = await within(section).findByRole('group', {
      name: 'Formats your receiver decodes',
    })
    expect(within(formats).getByRole('checkbox', { name: 'Dolby Digital (AC3)' })).toBeChecked()
    expect(within(formats).getByRole('checkbox', { name: 'DTS' })).toBeChecked()
    expect(
      within(section).getByText(
        'macOS passes Dolby Digital and DTS core to the receiver; TrueHD, DTS-HD MA and E-AC3 play as PCM.',
      ),
    ).toBeInTheDocument()
    expect(within(section).getByText('Volume is set on your receiver.')).toBeInTheDocument()
  })

  it('saves the formats without DTS when it is unchecked', async () => {
    const { section, writes } = await renderSection({
      initial: { ...DEFAULT_OUTPUT_SETTINGS, profile: 'passthrough' },
    })
    await userEvent.click(await within(section).findByRole('checkbox', { name: 'DTS' }))
    await waitFor(() => expect(writes.at(-1)?.passthrough ?? null).toEqual(['ac3']))
    await userEvent.click(within(section).getByRole('checkbox', { name: 'DTS' }))
    await waitFor(() => expect(writes.at(-1)?.passthrough ?? null).toEqual(['ac3', 'dts']))
  })

  it('keeps the formats it does not offer when it saves', async () => {
    const { section, writes } = await renderSection({
      initial: {
        ...DEFAULT_OUTPUT_SETTINGS,
        profile: 'passthrough',
        passthrough: ['ac3', 'truehd'],
      },
    })
    await userEvent.click(await within(section).findByRole('checkbox', { name: 'DTS' }))
    await waitFor(() =>
      expect(writes.at(-1)?.passthrough ?? null).toEqual(['ac3', 'dts', 'truehd']),
    )
  })

  it('offers spatial audio for headphones only and saves it', async () => {
    const { section, writes } = await renderSection()
    expect(within(section).queryByRole('checkbox', { name: 'Spatial audio (AirPods)' })).toBeNull()
    await userEvent.click(within(section).getByRole('radio', { name: 'Headphones' }))
    await userEvent.click(
      await within(section).findByRole('checkbox', { name: 'Spatial audio (AirPods)' }),
    )
    await waitFor(() =>
      expect(writes.at(-1)).toEqual({
        ...DEFAULT_OUTPUT_SETTINGS,
        profile: 'headphones',
        spatial: true,
      }),
    )
    expect(
      within(section).queryByRole('group', { name: 'Formats your receiver decodes' }),
    ).toBeNull()
  })

  it('saves the chosen device', async () => {
    const { section, writes } = await renderSection()
    await userEvent.selectOptions(
      within(section).getByRole('combobox', { name: 'Output device' }),
      'Den receiver',
    )
    await waitFor(() =>
      expect(writes).toEqual([{ ...DEFAULT_OUTPUT_SETTINGS, device: 'coreaudio/Den' }]),
    )
  })

  it('shows a stored device that is no longer listed as the system default', async () => {
    const { section } = await renderSection({
      initial: { ...DEFAULT_OUTPUT_SETTINGS, device: 'coreaudio/Gone' },
    })
    expect(within(section).getByRole('combobox', { name: 'Output device' })).toHaveValue('auto')
  })

  it('confirms in an always-mounted status, and says what the change applies to', async () => {
    const { section } = await renderSection()
    const status = within(section).getByRole('status')
    expect(status.tagName).toBe('OUTPUT')
    expect(status).toHaveTextContent('')
    await userEvent.click(within(section).getByRole('radio', { name: 'Headphones' }))
    await waitFor(() =>
      expect(status).toHaveTextContent('Sound output saved. Applies to the video you play next.'),
    )
    expect(within(section).queryByRole('alert')).toBeNull()
  })

  it('says why when main refuses, as an alert, and goes back to what is stored', async () => {
    const { section } = await renderSection({
      refusal: 'raven player could not do that. Try again.',
    })
    await userEvent.click(within(section).getByRole('radio', { name: 'Headphones' }))
    const alert = await within(section).findByRole('alert')
    expect(alert).toHaveTextContent('raven player could not do that. Try again.')
    expect(alert).toHaveAttribute('data-refused', 'true')
    expect(within(section).getByRole('status')).toHaveTextContent('')
    await waitFor(() =>
      expect(
        within(section).getByRole('radio', { name: 'Speakers or TV (PCM, up to 7.1)' }),
      ).toBeChecked(),
    )
  })

  it('builds the next change on what is stored, not on a refused pick', async () => {
    const { section, writes } = await renderSection({ refusal: 'Not now.' })
    await userEvent.click(within(section).getByRole('radio', { name: 'Headphones' }))
    await within(section).findByRole('alert')
    await userEvent.selectOptions(
      within(section).getByRole('combobox', { name: 'Output device' }),
      'Den receiver',
    )
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes.at(-1)).toEqual({ ...DEFAULT_OUTPUT_SETTINGS, device: 'coreaudio/Den' })
  })

  it('says the sound output could not be saved when the request itself fails', async () => {
    const { section } = await renderSection({ isRejecting: true })
    await userEvent.click(within(section).getByRole('radio', { name: 'Headphones' }))
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'raven player could not save the sound output. Try again.',
    )
    await waitFor(() =>
      expect(
        within(section).getByRole('radio', { name: 'Speakers or TV (PCM, up to 7.1)' }),
      ).toBeChecked(),
    )
  })

  it('clears the alert on the next change', async () => {
    const { section } = await renderSection({ refuseOnce: 'Not now.' })
    await userEvent.click(within(section).getByRole('radio', { name: 'Headphones' }))
    await within(section).findByRole('alert')
    await userEvent.click(within(section).getByRole('radio', { name: 'Receiver passthrough' }))
    await waitFor(() => expect(within(section).queryByRole('alert')).toBeNull())
    await waitFor(() => expect(within(section).getByRole('status')).toHaveTextContent('saved'))
  })

  /** Main answering each write only when the test says, in the order they came. */
  const heldMain = () => {
    const replies: Array<(reply: { type: 'done' } | { type: 'refused'; message: string }) => void> =
      []
    const writes: OutputSettings[] = []
    const client = fakeClient({
      request: async (asked: DesktopRequest) => {
        if (asked.type === 'readOutput') {
          return {
            type: 'output',
            output: DEFAULT_OUTPUT_SETTINGS,
            devices: DEVICES,
            isEngineReady: true,
          }
        }
        if (asked.type !== 'writeOutput') return { type: 'recents', recents: [] }
        writes.push(asked.output)
        const reply = Promise.withResolvers<
          { type: 'done' } | { type: 'refused'; message: string }
        >()
        replies.push(reply.resolve)
        return reply.promise
      },
    })
    const answer = (reply: { type: 'done' } | { type: 'refused'; message: string }) =>
      act(async () => {
        const next = replies.shift()
        if (next === undefined) throw new Error('no write is waiting')
        next(reply)
      })
    return { client, writes, answer }
  }

  it('composes two quick changes, writing the second once the first is confirmed', async () => {
    const main = heldMain()
    renderDesktop({ client: main.client, route: '/settings' })
    const section = await screen.findByRole('region', { name: 'This computer' })
    await userEvent.click(await within(section).findByRole('radio', { name: 'Headphones' }))
    await userEvent.click(
      within(section).getByRole('checkbox', { name: 'Spatial audio (AirPods)' }),
    )
    expect(main.writes).toEqual([{ ...DEFAULT_OUTPUT_SETTINGS, profile: 'headphones' }])
    expect(within(section).getByRole('checkbox', { name: 'Spatial audio (AirPods)' })).toBeChecked()
    await main.answer({ type: 'done' })
    await waitFor(() => expect(main.writes).toHaveLength(2))
    expect(main.writes[1]).toEqual({
      ...DEFAULT_OUTPUT_SETTINGS,
      profile: 'headphones',
      spatial: true,
    })
    await main.answer({ type: 'done' })
    await waitFor(() => expect(within(section).getByRole('status')).toHaveTextContent('saved'))
  })

  it('leaves a refused pick out of the write of a later pick made while it was in flight', async () => {
    const main = heldMain()
    renderDesktop({ client: main.client, route: '/settings' })
    const section = await screen.findByRole('region', { name: 'This computer' })
    await userEvent.click(await within(section).findByRole('radio', { name: 'Headphones' }))
    await userEvent.selectOptions(
      within(section).getByRole('combobox', { name: 'Output device' }),
      'Den receiver',
    )
    await main.answer({ type: 'refused', message: 'Not now.' })
    await waitFor(() => expect(main.writes).toHaveLength(2))
    expect(main.writes[1]).toEqual({ ...DEFAULT_OUTPUT_SETTINGS, device: 'coreaudio/Den' })
    expect(await within(section).findByRole('alert')).toHaveTextContent('Not now.')
    expect(
      within(section).getByRole('radio', { name: 'Speakers or TV (PCM, up to 7.1)' }),
    ).toBeChecked()
    await main.answer({ type: 'done' })
    await waitFor(() => expect(within(section).getByRole('status')).toHaveTextContent('saved'))
  })

  it('does not say the volume is on the receiver when no format is chosen', async () => {
    const { section } = await renderSection({
      initial: { ...DEFAULT_OUTPUT_SETTINGS, profile: 'passthrough', passthrough: [] },
    })
    expect(
      await within(section).findByText('No formats chosen, so sound plays as PCM.'),
    ).toBeInTheDocument()
    expect(within(section).queryByText('Volume is set on your receiver.')).toBeNull()
  })

  it('treats formats it cannot carry as no format at all', async () => {
    const { section } = await renderSection({
      initial: { ...DEFAULT_OUTPUT_SETTINGS, profile: 'passthrough', passthrough: ['truehd'] },
    })
    expect(
      await within(section).findByText('No formats chosen, so sound plays as PCM.'),
    ).toBeInTheDocument()
  })

  it('follows the checkboxes between the two volume sentences', async () => {
    const { section } = await renderSection({
      initial: { ...DEFAULT_OUTPUT_SETTINGS, profile: 'passthrough' },
    })
    await userEvent.click(
      await within(section).findByRole('checkbox', { name: 'Dolby Digital (AC3)' }),
    )
    await userEvent.click(within(section).getByRole('checkbox', { name: 'DTS' }))
    await within(section).findByText('No formats chosen, so sound plays as PCM.')
    await userEvent.click(within(section).getByRole('checkbox', { name: 'DTS' }))
    await within(section).findByText('Volume is set on your receiver.')
  })

  it('says the device list is unavailable when the engine is ready but lists nothing', async () => {
    const { section } = await renderSection({ devices: [], isEngineReady: true })
    expect(within(section).getByText('Device list unavailable.')).toBeInTheDocument()
    expect(within(section).getByRole('combobox', { name: 'Output device' })).toBeEnabled()
  })

  it('still offers the profiles and says the device list is unavailable without the engine', async () => {
    const { section, writes } = await renderSection({ devices: [], isEngineReady: false })
    expect(
      within(section).getByText(
        "raven player's video engine is not running, so sound settings wait until it is.",
      ),
    ).toBeInTheDocument()
    expect(within(section).getByText('Device list unavailable.')).toBeInTheDocument()
    expect(within(section).getByRole('combobox', { name: 'Output device' })).toBeDisabled()
    await userEvent.click(within(section).getByRole('radio', { name: 'Receiver passthrough' }))
    await waitFor(() => expect(writes).toHaveLength(1))
  })

  it('says so when the settings cannot be read, and offers no controls to overwrite them', async () => {
    const client = fakeClient({
      request: async (asked) =>
        asked.type === 'readOutput'
          ? { type: 'refused', message: 'raven player could not read its settings.' }
          : { type: 'recents', recents: [] },
    })
    renderDesktop({ client, route: '/settings' })
    const section = await screen.findByRole('region', { name: 'This computer' })
    expect(
      await within(section).findByText('raven player could not read its settings.'),
    ).toBeInTheDocument()
    expect(within(section).queryByRole('radio')).toBeNull()
  })
})
