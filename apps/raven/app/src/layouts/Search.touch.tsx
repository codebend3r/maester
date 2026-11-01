import { TouchSearchBar } from '@/layouts/TouchSearchBar'
import { TouchShelfPage } from '@/layouts/TouchShelfPage'
import type { SearchFieldProps, SearchKit, SearchLayoutProps } from '@/layouts/searchKit'

/**
 * A search box under the thumb, the one Home wears too: the keyboard's Search key searches at
 * once, and while it holds text a button beside it empties it, which asks for nothing.
 */
const SearchField = ({ search, label, isPreferred = false }: SearchFieldProps) => (
  <TouchSearchBar
    isPreferred={isPreferred}
    label={label}
    onRun={() => search.searchFor(search.text.trim())}
    search={search}
  />
)

/**
 * The search screen on a phone or tablet: Home's page, with the field it opens on in the
 * header and the results as the same shelves below it.
 */
const SearchLayout = ({ title, label, search, notice, onBack, children }: SearchLayoutProps) => (
  <TouchShelfPage
    notice={notice}
    onBack={onBack}
    search={<SearchField isPreferred label={label} search={search} />}
    title={title}
  >
    {children}
  </TouchShelfPage>
)

/** Search on a phone or tablet. */
export const touchSearch: SearchKit = { SearchField, SearchLayout }
