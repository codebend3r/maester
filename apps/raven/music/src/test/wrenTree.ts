import { Album } from '@/screens/Album'
import { Artist } from '@/screens/Artist'
import { Home } from '@/screens/Home'
import { Library } from '@/screens/Library'
import { Playlist } from '@/screens/Playlist'
import { Search } from '@/screens/Search'
import { Settings } from '@/screens/Settings'
import { SignIn } from '@/screens/SignIn'
import { WrenRoot } from '@/WrenRoot'
import { WrenTabs } from '@/WrenTabs'

/** Wren's route tree as `app/` lays it out, for `renderRouter`. */
export const WREN_TREE = {
  _layout: WrenRoot,
  '(tabs)/_layout': WrenTabs,
  '(tabs)/index': Home,
  '(tabs)/library': Library,
  '(tabs)/search': Search,
  '(tabs)/settings': Settings,
  'album/[id]': Album,
  'artist/[id]': Artist,
  'playlist/[id]': Playlist,
  'sign-in': SignIn,
}
