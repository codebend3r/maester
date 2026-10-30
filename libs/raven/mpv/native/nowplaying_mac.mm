#include "nowplaying.h"
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>
#include <mutex>
#include <utility>

// Only the main thread may touch MediaPlayer's centers, and a handler the system holds can
// fire after the addon let go: the state is shared with every block, and `stop` empties it
// under its lock before the blocks see it.
struct RavenNowPlayingState {
    std::mutex mutex;
    std::function<void(const RavenRemoteCommand &)> onCommand;
    std::vector<std::pair<MPRemoteCommand *, id>> targets;
    bool isListening = false;
};

RavenNowPlaying::RavenNowPlaying() : state(std::make_shared<RavenNowPlayingState>()) {}
RavenNowPlaying::~RavenNowPlaying() { stop(); }

static void onMain(void (^block)(void)) {
    if ([NSThread isMainThread]) {
        block();
        return;
    }
    dispatch_async(dispatch_get_main_queue(), block);
}

static NSString *text(const std::string &value) {
    return [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding] ?: @"";
}

static void deliver(const std::shared_ptr<RavenNowPlayingState> &shared, const char *name, double time) {
    std::function<void(const RavenRemoteCommand &)> handler;
    {
        std::lock_guard<std::mutex> lock(shared->mutex);
        handler = shared->onCommand;
    }
    if (handler) handler(RavenRemoteCommand{name, time});
}

void RavenNowPlaying::listen(std::function<void(const RavenRemoteCommand &)> onCommand) {
    auto shared = state;
    {
        std::lock_guard<std::mutex> lock(shared->mutex);
        if (shared->isListening) return;
        shared->isListening = true;
        shared->onCommand = std::move(onCommand);
    }
    onMain(^{
        MPRemoteCommandCenter *center = [MPRemoteCommandCenter sharedCommandCenter];
        std::vector<std::pair<MPRemoteCommand *, id>> targets;
        auto take = [&](MPRemoteCommand *command, const char *name) {
            command.enabled = YES;
            id target = [command addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *) {
                deliver(shared, name, 0);
                return MPRemoteCommandHandlerStatusSuccess;
            }];
            targets.emplace_back(command, target);
        };
        take(center.playCommand, "play");
        take(center.pauseCommand, "pause");
        take(center.togglePlayPauseCommand, "toggle");
        take(center.nextTrackCommand, "next");
        take(center.previousTrackCommand, "previous");
        take(center.stopCommand, "stop");
        MPRemoteCommand *position = center.changePlaybackPositionCommand;
        position.enabled = YES;
        id seekTarget = [position addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
            if (![event isKindOfClass:[MPChangePlaybackPositionCommandEvent class]])
                return MPRemoteCommandHandlerStatusCommandFailed;
            deliver(shared, "seek", ((MPChangePlaybackPositionCommandEvent *)event).positionTime);
            return MPRemoteCommandHandlerStatusSuccess;
        }];
        targets.emplace_back(position, seekTarget);
        std::lock_guard<std::mutex> lock(shared->mutex);
        if (!shared->isListening) {
            // Stopped before this ran: let the targets go again.
            for (auto &entry : targets) [entry.first removeTarget:entry.second];
            return;
        }
        shared->targets = std::move(targets);
    });
}

void RavenNowPlaying::set(const RavenNowPlayingInfo &info) {
    RavenNowPlayingInfo copy = info;
    onMain(^{
        NSMutableDictionary *values = [NSMutableDictionary dictionary];
        values[MPMediaItemPropertyTitle] = text(copy.title);
        values[MPMediaItemPropertyArtist] = text(copy.artist);
        values[MPMediaItemPropertyAlbumTitle] = text(copy.album);
        values[MPMediaItemPropertyPlaybackDuration] = @(copy.duration);
        values[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(copy.position);
        values[MPNowPlayingInfoPropertyPlaybackRate] = @(copy.isPlaying ? 1.0 : 0.0);
        values[MPNowPlayingInfoPropertyMediaType] = @(MPNowPlayingInfoMediaTypeAudio);
        if (!copy.artwork.empty()) {
            NSData *data = [NSData dataWithBytes:copy.artwork.data() length:copy.artwork.size()];
            NSImage *image = [[NSImage alloc] initWithData:data];
            if (image) {
                values[MPMediaItemPropertyArtwork] =
                    [[MPMediaItemArtwork alloc] initWithBoundsSize:image.size
                                                    requestHandler:^NSImage *(CGSize) { return image; }];
            }
        }
        MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
        center.nowPlayingInfo = values;
        center.playbackState = copy.isPlaying ? MPNowPlayingPlaybackStatePlaying : MPNowPlayingPlaybackStatePaused;
    });
}

void RavenNowPlaying::clear() {
    onMain(^{
        MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
        center.nowPlayingInfo = nil;
        center.playbackState = MPNowPlayingPlaybackStateStopped;
    });
}

void RavenNowPlaying::stop() {
    auto shared = state;
    std::vector<std::pair<MPRemoteCommand *, id>> targets;
    {
        std::lock_guard<std::mutex> lock(shared->mutex);
        if (!shared->isListening) return;
        shared->isListening = false;
        shared->onCommand = nullptr;
        targets = std::move(shared->targets);
        shared->targets.clear();
    }
    onMain(^{
        for (auto &entry : targets) {
            [entry.first removeTarget:entry.second];
            entry.first.enabled = NO;
        }
        MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
        center.nowPlayingInfo = nil;
        center.playbackState = MPNowPlayingPlaybackStateStopped;
    });
}
