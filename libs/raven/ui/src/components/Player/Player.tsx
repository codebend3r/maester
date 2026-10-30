import { type ComponentType, useState } from 'react'
import { PLAYER_SOURCE_KINDS, isPictureSubtitle } from '@raven/core'
import { ENGINE_KINDS, type Engine, type HtmlSource, sourceKey } from '@/components/Player/engine'
import styles from '@/components/Player/Player.module.scss'
import { useHostServices } from '@/stores/playerServices'
import { KeyedView, type ViewOf, type ViewsOf } from '@/components/KeyedView/KeyedView'
import { NativeStage } from '@/components/Player/NativeStage'
import { Preloader } from '@/components/Player/Preloader'
import { DIRECT_RENDITION } from '@/components/Player/rendition'
import { Stage } from '@/components/Player/Stage'
import { Unplayable } from '@/components/Player/Unplayable'
import { useLeave } from '@/components/Player/useLeave'
import {
  PLAYBACK_STATUSES,
  type PlaybackStatus,
  usePlaybackLadder,
} from '@/components/Player/usePlaybackLadder'
import { type TrackSelection, useTrackSelection } from '@/components/Player/useTrackSelection'

const Waiting = () => (
  <div className={styles.stage} aria-busy="true">
    <Preloader />
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

/** Whether the player is still playing, or has failed and shows why. */
const RUN_STATES = { running: 'running', failed: 'failed' } as const

type RunState = (typeof RUN_STATES)[keyof typeof RUN_STATES]

const runStateOf = (problems: readonly string[]): RunState =>
  problems.length > 0 ? RUN_STATES.failed : RUN_STATES.running

type FailedViewProps = { problems: string[]; onBack: () => void }

const FailedView = ({ problems, onBack }: FailedViewProps) => (
  <Unplayable problems={problems} onBack={onBack} onTryAnyway={null} />
)

type EngineKind = Engine['kind']

type EngineOf<K extends EngineKind> = Extract<Engine, { kind: K }>

type EngineScreenProps<K extends EngineKind> = { engine: EngineOf<K>; onBack: () => void }

/** Each engine kind's view props, or only `Keys`' for a builder generic over the kind. */
type EngineViewsProps<Keys extends EngineKind = EngineKind> = { [K in Keys]: EngineScreenProps<K> }

type EngineViewOfProps<K extends EngineKind> = EngineScreenProps<K> & { kind: K }

/** The view for the engine's kind, so each view is handed its own kind of engine. */
const engineViewOf = <K extends EngineKind>({
  kind,
  engine,
  onBack,
}: EngineViewOfProps<K>): ViewOf<EngineViewsProps<K>, K> => ({
  key: kind,
  props: { engine, onBack },
})

type PlayerProps = { engine: Engine }

export const Player = ({ engine }: PlayerProps) => {
  const { title } = useHostServices()
  const leave = useLeave(title.backTo)
  return (
    <KeyedView<EngineViewsProps>
      views={ENGINE_VIEWS}
      view={engineViewOf({ kind: engine.kind, engine, onBack: leave })}
    />
  )
}

type NativeViewProps = {
  engine: EngineOf<typeof ENGINE_KINDS.native>
  onBack: () => void
}

type NativeRunProps = NativeViewProps & {
  problems: string[]
  onFailure: (message: string) => void
}

type NativeRunningProps = NativeRunProps

const NativeRunning = ({ engine, onBack, onFailure }: NativeRunningProps) => (
  <NativeStage
    key={sourceKey(engine.source)}
    engine={engine}
    onBack={onBack}
    onFailure={onFailure}
  />
)

const NATIVE_RUNS = {
  [RUN_STATES.running]: NativeRunning,
  [RUN_STATES.failed]: FailedView,
} as const satisfies Record<RunState, ComponentType<NativeRunProps>>

const NativeView = ({ engine, onBack }: NativeViewProps) => {
  const [problems, setProblems] = useState<string[]>([])
  const Run = NATIVE_RUNS[runStateOf(problems)]
  return (
    <Run
      engine={engine}
      onBack={onBack}
      problems={problems}
      onFailure={(message) => setProblems([message])}
    />
  )
}

type HtmlSourceKind = HtmlSource['kind']

type HtmlSourceOf<K extends HtmlSourceKind> = Extract<HtmlSource, { kind: K }>

type SourceScreenProps<K extends HtmlSourceKind> = { source: HtmlSourceOf<K>; onBack: () => void }

/** Each source kind's player props, or only `Keys`' for a builder generic over the kind. */
type SourceViewsProps<Keys extends HtmlSourceKind = HtmlSourceKind> = {
  [K in Keys]: SourceScreenProps<K>
}

type SourceViewOfProps<K extends HtmlSourceKind> = SourceScreenProps<K> & { kind: K }

/** The player for the source's kind, so each player is handed its own kind of source. */
const sourceViewOf = <K extends HtmlSourceKind>({
  kind,
  source,
  onBack,
}: SourceViewOfProps<K>): ViewOf<SourceViewsProps<K>, K> => ({
  key: kind,
  props: { source, onBack },
})

type HtmlViewProps = {
  engine: EngineOf<typeof ENGINE_KINDS.html>
  onBack: () => void
}

const HtmlView = ({ engine, onBack }: HtmlViewProps) => (
  <KeyedView<SourceViewsProps>
    views={SOURCE_VIEWS}
    view={sourceViewOf({ kind: engine.source.kind, source: engine.source, onBack })}
  />
)

type FilePlayerProps = {
  source: HtmlSourceOf<typeof PLAYER_SOURCE_KINDS.file>
  onBack: () => void
}

type FileRunProps = FilePlayerProps & {
  problems: string[]
  onFailure: (message: string) => void
}

type FileRunningProps = FileRunProps

const FileRunning = ({ source, onBack, onFailure }: FileRunningProps) => (
  <Stage
    engine={{ kind: ENGINE_KINDS.html, source }}
    onBack={onBack}
    rendition={DIRECT_RENDITION}
    selection={fileSelection}
    onFailure={({ message }) => onFailure(message)}
  />
)

const FILE_RUNS = {
  [RUN_STATES.running]: FileRunning,
  [RUN_STATES.failed]: FailedView,
} as const satisfies Record<RunState, ComponentType<FileRunProps>>

const FilePlayer = ({ source, onBack }: FilePlayerProps) => {
  const [problems, setProblems] = useState<string[]>([])
  const Run = FILE_RUNS[runStateOf(problems)]
  return (
    <Run
      source={source}
      onBack={onBack}
      problems={problems}
      onFailure={(message) => setProblems([message])}
    />
  )
}

type ServerPlayerProps = {
  source: HtmlSourceOf<typeof PLAYER_SOURCE_KINDS.server>
  onBack: () => void
}

type StatusKey = PlaybackStatus['status']

type PlaybackOf<K extends StatusKey> = Extract<PlaybackStatus, { status: K }>

type PlaybackViewProps<K extends StatusKey> = ServerPlayerProps & {
  playback: PlaybackOf<K>
  selection: ReturnType<typeof useTrackSelection>
}

/** Each status's view props, or only `Keys`' for a builder generic over the status. */
type PlaybackViewsProps<Keys extends StatusKey = StatusKey> = { [K in Keys]: PlaybackViewProps<K> }

const WaitingView = () => <Waiting />

type UnplayableViewProps = PlaybackViewProps<typeof PLAYBACK_STATUSES.unplayable>

const UnplayableView = ({ source, onBack, playback, selection }: UnplayableViewProps) => (
  <Unplayable
    onBack={onBack}
    problems={playback.problems}
    onTryAnyway={playback.tryAnyway}
    context={{
      media: source.media,
      tracks: selection.tracks,
      audio: selection.audio,
      subtitle: selection.subtitle,
      ladder: playback.facts,
    }}
  />
)

/** Whether the tracks a playing stage needs are in yet. */
const TRACK_STATES = { waiting: 'waiting', ready: 'ready' } as const

type TrackState = (typeof TRACK_STATES)[keyof typeof TRACK_STATES]

type PlayingProps = PlaybackViewProps<typeof PLAYBACK_STATUSES.playing>

type PlayingStageProps = PlayingProps

const PlayingStage = ({ source, onBack, playback, selection }: PlayingStageProps) => (
  <Stage
    engine={{ kind: ENGINE_KINDS.html, source }}
    onBack={onBack}
    rendition={playback.rendition}
    selection={selection}
    onFailure={playback.fail}
    onSlow={playback.slow ?? undefined}
    steppedDown={playback.steppedDown}
    choices={playback.choices}
  />
)

const PLAYING_VIEWS = {
  [TRACK_STATES.waiting]: WaitingView,
  [TRACK_STATES.ready]: PlayingStage,
} as const satisfies Record<TrackState, ComponentType<PlayingProps>>

type PlayingViewProps = PlayingProps

const PlayingView = (props: PlayingViewProps) => {
  const View =
    PLAYING_VIEWS[props.selection.isWaitingForTracks ? TRACK_STATES.waiting : TRACK_STATES.ready]
  return <View {...props} />
}

const PLAYBACK_VIEWS = {
  [PLAYBACK_STATUSES.waiting]: WaitingView,
  [PLAYBACK_STATUSES.unplayable]: UnplayableView,
  [PLAYBACK_STATUSES.playing]: PlayingView,
} as const satisfies ViewsOf<PlaybackViewsProps>

type PlaybackViewOfProps<K extends StatusKey> = PlaybackViewProps<K> & { status: K }

/** The view for the ladder's status, so each view is handed its own kind of playback. */
const playbackViewOf = <K extends StatusKey>({
  status,
  ...props
}: PlaybackViewOfProps<K>): ViewOf<PlaybackViewsProps<K>, K> => ({ key: status, props })

const ServerPlayer = ({ source, onBack }: ServerPlayerProps) => {
  const selection = useTrackSelection({ mediaId: source.media.id, api: source.api })
  const playback = usePlaybackLadder({
    media: source.media,
    api: source.api,
    audio: selection.audio,
    isDefaultAudio: selection.isDefaultAudio,
    burn: isPictureSubtitle(selection.subtitle) ? selection.subtitle.id : null,
  })
  return (
    <KeyedView<PlaybackViewsProps>
      views={PLAYBACK_VIEWS}
      view={playbackViewOf({
        status: playback.status,
        playback,
        selection,
        source,
        onBack,
      })}
    />
  )
}

const ENGINE_VIEWS = {
  [ENGINE_KINDS.html]: HtmlView,
  [ENGINE_KINDS.native]: NativeView,
} as const satisfies ViewsOf<EngineViewsProps>

const SOURCE_VIEWS = {
  [PLAYER_SOURCE_KINDS.server]: ServerPlayer,
  [PLAYER_SOURCE_KINDS.file]: FilePlayer,
} as const satisfies ViewsOf<SourceViewsProps>
