import { useState } from 'react'
import { PLAYER_SOURCE_KINDS } from '@raven/core'
import { ENGINE_KINDS, type Engine, type HtmlSource, sourceKey } from '@/components/Player/engine'
import styles from '@/components/Player/Player.module.scss'
import { useHostServices } from '@/stores/playerServices'
import { NativeStage } from '@/components/Player/NativeStage'
import { DIRECT_RENDITION } from '@/components/Player/rendition'
import { Stage } from '@/components/Player/Stage'
import { Unplayable } from '@/components/Player/Unplayable'
import { useLeave } from '@/components/Player/useLeave'
import { PLAYBACK_STATUSES, usePlaybackLadder } from '@/components/Player/usePlaybackLadder'
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
  const { title } = useHostServices()
  const leave = useLeave(title.backTo)
  switch (engine.kind) {
    case ENGINE_KINDS.html:
      return <HtmlView engine={engine} onBack={leave} />
    case ENGINE_KINDS.native:
      return <NativeView engine={engine} onBack={leave} />
    default: {
      const unknown: never = engine
      return unknown
    }
  }
}

const NativeView = ({
  engine,
  onBack,
}: {
  engine: Extract<Engine, { kind: 'native' }>
  onBack: () => void
}) => {
  const [failure, setFailure] = useState<string | null>(null)
  if (failure !== null) {
    return <Unplayable problems={[failure]} onBack={onBack} onTryAnyway={null} />
  }
  return (
    <NativeStage
      key={sourceKey(engine.source)}
      engine={engine}
      onBack={onBack}
      onFailure={setFailure}
    />
  )
}

const HtmlView = ({
  engine,
  onBack,
}: {
  engine: Extract<Engine, { kind: 'html' }>
  onBack: () => void
}) => {
  const source = engine.source
  switch (source.kind) {
    case PLAYER_SOURCE_KINDS.server:
      return <ServerPlayer source={source} onBack={onBack} />
    case PLAYER_SOURCE_KINDS.file:
      return <FilePlayer source={source} onBack={onBack} />
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
  if (failure !== null) {
    return <Unplayable problems={[failure]} onBack={onBack} onTryAnyway={null} />
  }
  return (
    <Stage
      engine={{ kind: 'html', source }}
      onBack={onBack}
      rendition={DIRECT_RENDITION}
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
    case PLAYBACK_STATUSES.waiting:
      return <Waiting />
    case PLAYBACK_STATUSES.unplayable:
      return (
        <Unplayable onBack={onBack} problems={playback.problems} onTryAnyway={playback.tryAnyway} />
      )
    case PLAYBACK_STATUSES.playing:
      if (selection.isWaitingForTracks) return <Waiting />
      return (
        <Stage
          engine={{ kind: 'html', source }}
          onBack={onBack}
          rendition={playback.rendition}
          selection={selection}
          onFailure={playback.fail}
          onSlow={playback.slow ?? undefined}
          steppedDown={playback.steppedDown}
          choices={playback.choices}
        />
      )
    default: {
      const unknown: never = playback
      return unknown
    }
  }
}
