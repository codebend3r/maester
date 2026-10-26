import type { Engine } from '@/components/Player/engine'
import { DIRECT_RENDITION } from '@/components/Player/rendition'
import { PlayerChrome } from '@/components/Player/Stage'
import { useNativeEngine } from '@/components/Player/useNativeEngine'
import { useNativeSurface } from '@/components/Player/useNativeSurface'
import { useFullscreen } from '@/components/Player/useStageChrome'

type NativeStageProps = {
  engine: Extract<Engine, { kind: 'native' }>
  onBack: () => void
  onFailure: (message: string) => void
}

/** The stage for a player in another process: the picture is its own surface under a transparent page. */
export const NativeStage = ({ engine, onBack, onFailure }: NativeStageProps) => {
  const fullscreen = useFullscreen()
  const native = useNativeEngine({
    player: engine.player,
    source: engine.source,
    onFailure,
    toggleFullscreen: fullscreen.toggle,
  })
  useNativeSurface({ isWaiting: native.engine.state.waiting })
  return (
    <PlayerChrome
      engine={native.engine}
      onBack={onBack}
      rendition={DIRECT_RENDITION}
      selection={native.selection}
      subtitleStatus={native.selection.subtitle ? 'ready' : 'off'}
      fullscreen={fullscreen}
    />
  )
}
