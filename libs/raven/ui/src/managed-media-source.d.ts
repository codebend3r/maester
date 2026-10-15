// Safari's power-aware Media Source Extensions, the only kind iOS has
// (17.1 and later). It is a MediaSource underneath; lib.dom does not
// declare it yet.
interface Window {
  ManagedMediaSource?: typeof MediaSource
}
