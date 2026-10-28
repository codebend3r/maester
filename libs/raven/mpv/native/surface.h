#pragma once
#include <cstdint>
#include <memory>

// The video surface mpv draws into, one per platform: a CAMetalLayer view under
// Chromium's content view on macOS (surface_mac.mm), the BrowserWindow's own HWND
// on Windows (surface_win.cpp). addon.cpp only sees this interface.
struct RavenSurfaceState;

struct RavenSurface {
    RavenSurface();
    ~RavenSurface();
    RavenSurface(const RavenSurface &) = delete;
    RavenSurface &operator=(const RavenSurface &) = delete;

    // Takes the handle Electron's getNativeWindowHandle() gives; throws std::runtime_error.
    void attach(void *nativeHandle);
    void detach();
    bool isAttached() const;
    // From a thread that is not the platform's main thread (a GC finalizer).
    void detachFromAnyThread();

    // What mpv is told: its `wid` and the GPU API and context this surface wants.
    int64_t wid() const;
    const char *gpuApi() const;
    // nullptr lets mpv pick the context for the API.
    const char *gpuContext() const;

    double refreshRate() const;
    double edrHeadroom() const;
    unsigned sortRepairs() const;

private:
    std::unique_ptr<RavenSurfaceState> state;
};
