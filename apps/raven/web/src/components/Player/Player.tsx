import { useState } from 'react'
import type { Engine, HtmlSource } from '@/components/Player/engine'
import styles from '@/components/Player/Player.module.scss'
import { usePlayerServices } from '@/components/Player/PlayerServices'
import { Stage } from '@/components/Player/Stage'
import { Unplayable } from '@/components/Player/Unplayable'
import { useLeave } from '@/components/Player/useLeave'
import { usePlaybackLadder } from '@/components/Player/usePlaybackLadder'
import { type TrackSelection, useTrackSelection } from '@/components/Player/useTrackSelection'

const Waiting = () => (
  <div className={styles.stage} aria-busy="true">
    <output className={styles.spinner} aria-label="Loading" />
  </div>
)

const fileSelection: TrackSelection = {
  tracks: null,
  tracksFailed: false,
  tracksPending: false,
  audio: null,
  isDefaultAudio: true,
  subtitle: null,
  isWaitingForTracks: false,
  pickAudio: () => {},
  pickSubtitle: () => {},
}

export const Player = ({ engine }: { engine: Engine }) => {
  const { title } = usePlayerServices()
  const leave = useLeave(title.backTo)
  const source = engine.source
  switch (source.kind) {
    case 'server':
      return <ServerPlayer source={source} onBack={leave} />
    case 'file':
      return <FilePlayer source={source} onBack={leave} />
    default: {
      const unknown: never = source
      return unknown
    }
  }
}

const FilePlayer = ({
  source,
  onBack,
}: {
  source: Extract<HtmlSource, { kind: 'file' }>
  onBack: () => void
}) => {
  const [failure, setFailure] = useState<string | null>(null)
  if (failure) return <Unplayable problems={[failure]} onBack={onBack} onTryAnyway={null} />
  return (
    <Stage
      engine={{ kind: 'html', source }}
      onBack={onBack}
      mode="direct"
      selection={fileSelection}
      onFailure={setFailure}
    />
  )
}

const ServerPlayer = ({
  source,
  onBack,
}: {
  source: Extract<HtmlSource, { kind: 'server' }>
  onBack: () => void
}) => {
  const selection = useTrackSelection({ mediaId: source.media.id, api: source.api })
  const playback = usePlaybackLadder({
    media: source.media,
    api: source.api,
    audio: selection.audio,
    isDefaultAudio: selection.isDefaultAudio,
  })
  switch (playback.status) {
    case 'waiting':
      return <Waiting />
    case 'unplayable':
      return (
        <Unplayable onBack={onBack} problems={playback.problems} onTryAnyway={playback.tryAnyway} />
      )
    case 'playing':
      if (selection.isWaitingForTracks) return <Waiting />
      return (
        <Stage
          engine={{ kind: 'html', source }}
          onBack={onBack}
          mode={playback.mode}
          selection={selection}
          onFailure={playback.fail}
        />
      )
    default: {
      const unknown: never = playback
      return unknown
    }
  }
}
