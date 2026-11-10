import type { ApiClient, Library as LibraryRecord } from '@raven/core'
import type { IconName } from '@raven/ui/iconDrawings'
import type { ReactNode } from 'react'

import { ToolButton } from '@/layouts'
import { LIBRARY_COPY } from '@/screens/copy'
import { RelockButton } from '@/screens/LockedLibrary'

/** What a page's button shows: the page's name, and the web's icon for it. */
export type PageTab = { name: string; icon: IconName }

/**
 * A library's pages as its toolbar frames them: the page open, every page in the order their
 * buttons stand, how each is named and drawn, the press between them, and the library itself,
 * whose Lock ends the toolbar while it is locked.
 */
export type PageFrame<P extends string> = {
  page: P
  pages: readonly P[]
  tabs: Record<P, PageTab>
  onChange: (page: P) => void
  library: LibraryRecord
  api: ApiClient
}

type PageTogglesProps<P extends string> = { frame: PageFrame<P> }

/** A press to each of the other pages, each named for where it goes. */
const PageToggles = <P extends string>({ frame }: PageTogglesProps<P>) =>
  frame.pages
    .filter((other) => other !== frame.page)
    .map((other) => (
      <ToolButton
        key={other}
        accessibilityLabel={LIBRARY_COPY.showPage(frame.tabs[other].name)}
        icon={frame.tabs[other].icon}
        label={frame.tabs[other].name}
        onPress={() => frame.onChange(other)}
      />
    ))

type PageToolsProps<P extends string> = {
  frame: PageFrame<P>
  /** The page's own buttons, between the page toggles and Lock. */
  children?: ReactNode
}

/**
 * A library page's toolbar: the ways to its other pages first, the page's own buttons, then
 * Lock last on a locked library, the web header's, which asks the PIN again the next time.
 */
export const PageTools = <P extends string>({ frame, children }: PageToolsProps<P>) => (
  <>
    <PageToggles frame={frame} />
    {children}
    {frame.library.settings.locked && <RelockButton api={frame.api} library={frame.library} />}
  </>
)
