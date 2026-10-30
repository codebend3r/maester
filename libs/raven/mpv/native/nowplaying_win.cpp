#include "nowplaying.h"

// Windows shows nothing yet: the System Media Transport Controls need a WinRT bridge that
// a later change brings. Every call is a no-op, so the addon's audio surface still plays.
struct RavenNowPlayingState {};

RavenNowPlaying::RavenNowPlaying() : state(std::make_shared<RavenNowPlayingState>()) {}
RavenNowPlaying::~RavenNowPlaying() = default;

void RavenNowPlaying::listen(std::function<void(const RavenRemoteCommand &)>) {}
void RavenNowPlaying::set(const RavenNowPlayingInfo &) {}
void RavenNowPlaying::clear() {}
void RavenNowPlaying::stop() {}
