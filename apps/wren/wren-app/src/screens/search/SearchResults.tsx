import { LIBRARY_COPY, RESULT_STATES, type ResultState, SEARCH_COPY } from '@raven/wren'
import type { ComponentType } from 'react'
import { View } from 'react-native'

import { LoadingMark } from '@/components/LoadingMark'
import { FilterResults } from '@/screens/search/FilterResults'
import { NoMatches, type ResultsProps } from '@/screens/search/ResultParts'
import { themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { EmptyState } from '@/ui/EmptyState'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(() => ({
  searching: { paddingVertical: SPACE.s8 },
}))

function Searching({ contentStyle }: ResultsProps) {
  const styles = useStyles()
  return (
    <View style={[contentStyle, styles.searching]}>
      <LoadingMark label={SEARCH_COPY.searching} />
    </View>
  )
}

function Failed({ results, contentStyle }: ResultsProps) {
  return (
    <View style={contentStyle}>
      <EmptyState
        body={SEARCH_COPY.failedHint(results.failure?.message ?? '')}
        icon={ICONS.alert}
        title={SEARCH_COPY.failed}
      />
    </View>
  )
}

function NoMusic({ contentStyle }: ResultsProps) {
  return (
    <View style={contentStyle}>
      <EmptyState body={SEARCH_COPY.noMusicHint} icon={ICONS.album} title={LIBRARY_COPY.noMusic} />
    </View>
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
