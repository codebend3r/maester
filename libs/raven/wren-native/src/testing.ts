/**
 * What the screen tests of Wren's apps on React Native build their fake raven from: the
 * listener, raven's music as the screens ask for it, and the device's song progress. Nothing here is bundled into an app;
 * only tests import it.
 */
export {
  AIRBAG,
  AUDIOBOOKS,
  FAVOURITES,
  LISTENER,
  LISTENER_ACCOUNT,
  LUCKY,
  MIXTAPE,
  MIXTAPE_PAGE,
  MUSIC,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  PARANOID,
  RADIOHEAD,
  RADIOHEAD_BACKGROUNDS,
  musicApi,
  trackFor,
} from '@/test/music'
export { keepSongs } from '@/test/songProgress'
