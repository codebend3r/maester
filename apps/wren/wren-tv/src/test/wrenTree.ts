import { Album } from '@/screens/Album'
import { Artist } from '@/screens/Artist'
import { Collection } from '@/screens/Collection'
import { Home } from '@/screens/Home'
import { Library } from '@/screens/Library'
import { NowPlaying } from '@/screens/NowPlaying'
import { Playlist } from '@/screens/Playlist'
import { Search } from '@/screens/Search'
import { Settings } from '@/screens/Settings'
import { SignIn } from '@/screens/SignIn'
import { WrenTvTabs } from '@/shell/WrenTvTabs'
import { WrenTvRoot } from '@/WrenTvRoot'

/** Wren on TV's route tree as `app/` lays it out, for `renderRouter`. */
export const WREN_TREE = {
  _layout: WrenTvRoot,
  '(tabs)/_layout': WrenTvTabs,
  '(tabs)/index': Home,
  '(tabs)/library': Library,
  '(tabs)/search': Search,
  '(tabs)/settings': Settings,
  'album/[id]': Album,
  'artist/[id]': Artist,
  'playlist/[id]': Playlist,
  'collection/[kind]': Collection,
  'now-playing': NowPlaying,
  'sign-in': SignIn,
}
