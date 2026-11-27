import { LIBRARY_COPY, RESULT_STATES, type ResultState, SEARCH_COPY, WREN_ICONS } from '@raven/wren'
import type { ComponentType } from 'react'
import { LoadingMark } from '@/components/LoadingMark/LoadingMark'
import { FilterResults } from '@/screens/Search/FilterResults'
import { NoMatches, type ResultsProps } from '@/screens/Search/ResultParts'
import { SIZES } from '@/theme/tokens'
import { EmptyState } from '@/ui/EmptyState/EmptyState'
import styles from '@/screens/Search/SearchResults.module.scss'

function Searching() {
  return (
    <section className={styles.searching}>
      <LoadingMark label={SEARCH_COPY.searching} size={SIZES.loadingMark} />
    </section>
  )
}

function Failed({ results }: ResultsProps) {
  return (
    <EmptyState
      body={SEARCH_COPY.failedHint(results.failure?.message ?? '')}
      icon={WREN_ICONS.alert}
      title={SEARCH_COPY.failed}
    />
  )
}

function NoMusic() {
  return (
    <EmptyState
      body={SEARCH_COPY.noMusicHint}
      icon={WREN_ICONS.album}
      title={LIBRARY_COPY.noMusic}
    />
  )
}

const STATE_VIEWS = {
  [RESULT_STATES.noMusic]: NoMusic,
  [RESULT_STATES.failed]: Failed,
  [RESULT_STATES.searching]: Searching,
  [RESULT_STATES.empty]: NoMatches,
  [RESULT_STATES.found]: FilterResults,
} as const satisfies Record<ResultState, ComponentType<ResultsProps>>

/** A search's results, or why there are none, under the field and the chips. */
export function SearchResults(props: ResultsProps) {
  const StateView = STATE_VIEWS[props.results.state]
  return <StateView {...props} />
}
