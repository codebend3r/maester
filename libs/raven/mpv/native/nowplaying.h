#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

// The system's Now Playing and transport controls, one per platform: MediaPlayer.framework
// on macOS (nowplaying_mac.mm), nothing yet on Windows (nowplaying_win.cpp). addon.cpp
// only sees this interface.
struct RavenNowPlayingInfo {
    std::string title;
    std::string artist;
    std::string album;
    double duration = 0;
    double position = 0;
    bool isPlaying = false;
    // Encoded image bytes (JPEG, PNG); empty for no cover.
    std::vector<uint8_t> artwork;
};

// A transport command the system sent: its name as mpv.ts reads it, and a seek's time.
struct RavenRemoteCommand {
    std::string name;
    double time = 0;
};

struct RavenNowPlayingState;

struct RavenNowPlaying {
    RavenNowPlaying();
    ~RavenNowPlaying();
    RavenNowPlaying(const RavenNowPlaying &) = delete;
    RavenNowPlaying &operator=(const RavenNowPlaying &) = delete;

    // Takes the system's transport controls; each reaches `onCommand` on the platform's
    // main thread. A second call changes nothing.
    void listen(std::function<void(const RavenRemoteCommand &)> onCommand);
    void set(const RavenNowPlayingInfo &info);
    void clear();
    // Lets the controls go and clears what shows; safe from any thread, and idempotent.
    void stop();

private:
    std::shared_ptr<RavenNowPlayingState> state;
};
