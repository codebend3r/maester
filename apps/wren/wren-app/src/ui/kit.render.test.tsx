import { describe, expect, it, jest } from '@jest/globals'
import { AUDIO_BITRATES, TRACK_STREAM_KINDS, audioQualityOf } from '@raven/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KIT_COPY, NOW_PLAYING_COPY, SONG_LEADS, WREN_ICONS } from '@raven/wren'

import { AlertDialog } from '@/ui/AlertDialog'
import { ArtistRow } from '@/ui/ArtistRow'
import { BottomSheet } from '@/ui/BottomSheet'
import { AIRBAG } from '@raven/wren-native/testing'
import { Button } from '@/ui/Button'
import { QualityChips } from '@/ui/QualityChips'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { SongRow } from '@/ui/SongRow'

// A phone's window with no notch, for what reads the safe area outside the router.
const SAFE_AREA = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
} as const

describe("Wren's kit", () => {
  it('keeps a loading button in place, busy and not pressable', async () => {
    const onPress = jest.fn()
    await render(<Button isLoading label="Sign in" onPress={onPress} />)
    const button = screen.getByRole('button', { name: 'Sign in' })
    expect(button.props.accessibilityState).toEqual(expect.objectContaining({ busy: true }))
    await fireEvent.press(button)
    expect(onPress).not.toHaveBeenCalled()
  })

  it("names an artist's counts without a zero", async () => {
    await render(
      <ArtistRow
        albumCount={0}
        name="Sia"
        onPress={() => undefined}
        picture={null}
        trackCount={1}
      />,
    )
    expect(screen.getByText('1 track')).toBeTruthy()
    expect(screen.queryByText(/0 albums/)).toBeNull()
  })

  it('marks a downloaded song and opens its menu from More', async () => {
    const onMore = jest.fn()
    await render(
      <SongRow
        duration="3:36"
        isDownloaded
        label="Airbag"
        lead={{ kind: SONG_LEADS.number, number: '1' }}
        onArtHold={() => undefined}
        onMore={onMore}
        onPress={() => undefined}
        title="Airbag"
      />,
    )
    expect(screen.getByLabelText('Downloaded')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'More for Airbag' }))
    expect(onMore).toHaveBeenCalled()
  })

  it('picks one segment at a time', async () => {
    const onSelect = jest.fn()
    await render(
      <SegmentedControl
        choices={[
          { key: 128, label: '128' },
          { key: 256, label: '256' },
        ]}
        label="Download quality"
        onSelect={onSelect}
        selected={256}
      />,
    )
    expect(screen.getByRole('radio', { name: '256' }).props.accessibilityState).toEqual({
      checked: true,
    })
    await fireEvent.press(screen.getByRole('radio', { name: '128' }))
    expect(onSelect).toHaveBeenCalledWith(128)
  })

  it("draws a lossless file's format and bit depth as chips, read out as one sentence", async () => {
    const quality = audioQualityOf({ track: AIRBAG, stream: { kind: TRACK_STREAM_KINDS.file } })
    await render(<QualityChips quality={quality} />)
    expect(screen.getByText('FLAC')).toBeTruthy()
    expect(screen.getByText('16-bit')).toBeTruthy()
    expect(screen.getByText('44.1 kHz · 900 kbps')).toBeTruthy()
    expect(
      screen.getByLabelText(
        KIT_COPY.labelled({
          label: NOW_PLAYING_COPY.quality,
          value: 'FLAC · 16-bit / 44.1 kHz · 900 kbps',
        }),
      ),
    ).toBeTruthy()
  })

  it("draws a download's format alone as a chip, and says it is one", async () => {
    const quality = audioQualityOf({
      track: AIRBAG,
      stream: { kind: TRACK_STREAM_KINDS.download, kbps: AUDIO_BITRATES.standard },
    })
    await render(<QualityChips quality={quality} />)
    expect(screen.getByText('AAC')).toBeTruthy()
    expect(screen.queryByText('16-bit')).toBeNull()
    expect(screen.getByText('256 kbps · Downloaded')).toBeTruthy()
  })

  it('lets a sheet go from its Close button once it has slid away', async () => {
    const onClose = jest.fn()
    await render(
      <SafeAreaProvider initialMetrics={SAFE_AREA}>
        <BottomSheet head={{ title: 'Airbag', subtitle: 'Radiohead' }} isOpen onClose={onClose}>
          <Button label="Play next" onPress={() => undefined} />
        </BottomSheet>
      </SafeAreaProvider>,
    )
    expect(screen.getByRole('header', { name: 'Airbag' })).toBeTruthy()
    const [, close] = screen.getAllByRole('button', { name: 'Close' })
    await fireEvent.press(close)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('asks before removing, with Cancel beside the action', async () => {
    const onConfirm = jest.fn()
    const onCancel = jest.fn()
    await render(
      <AlertDialog
        body="8.4 MB of music will be deleted from this device."
        confirmLabel="Remove"
        icon={WREN_ICONS.trash}
        isOpen
        onCancel={onCancel}
        onConfirm={onConfirm}
        title="Remove all downloads?"
      />,
    )
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }))
    expect(onConfirm).toHaveBeenCalled()
  })
})
