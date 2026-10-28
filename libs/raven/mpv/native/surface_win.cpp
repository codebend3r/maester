#include "surface.h"
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <stdexcept>

// Electron's handle on Windows is the BrowserWindow's HWND. mpv's Windows output makes
// its own child window inside it and draws there; Chromium's transparent output
// composites above it, so the page's controls show over the video.
struct RavenSurfaceState {
    HWND window = nullptr;
};

RavenSurface::RavenSurface() : state(std::make_unique<RavenSurfaceState>()) {}
// Defined here, where RavenSurfaceState is complete, for the unique_ptr.
RavenSurface::~RavenSurface() = default;

void RavenSurface::attach(void *nativeHandle) {
    HWND window = static_cast<HWND>(nativeHandle);
    if (!IsWindow(window)) throw std::runtime_error("BrowserWindow handle is not a window");
    if (state->window) throw std::runtime_error("Surface is already attached");
    state->window = window;
}

void RavenSurface::detach() { state->window = nullptr; }
bool RavenSurface::isAttached() const { return state->window != nullptr; }
// Nothing here touches a thread-bound object: mpv owns and destroys its child window.
void RavenSurface::detachFromAnyThread() { detach(); }

int64_t RavenSurface::wid() const { return (int64_t)(intptr_t)state->window; }
const char *RavenSurface::gpuApi() const { return "d3d11"; }
const char *RavenSurface::gpuContext() const { return nullptr; }

double RavenSurface::refreshRate() const {
    if (!state->window) return 0;
    HMONITOR monitor = MonitorFromWindow(state->window, MONITOR_DEFAULTTONEAREST);
    MONITORINFOEXW info{};
    info.cbSize = sizeof(info);
    if (!GetMonitorInfoW(monitor, &info)) return 0;
    DEVMODEW mode{};
    mode.dmSize = sizeof(mode);
    if (!EnumDisplaySettingsW(info.szDevice, ENUM_CURRENT_SETTINGS, &mode)) return 0;
    // 0 and 1 both mean the hardware default.
    return mode.dmDisplayFrequency > 1 ? (double)mode.dmDisplayFrequency : 0;
}

// HDR headroom is not read here yet; 1 keeps the host's colorspace hint off.
double RavenSurface::edrHeadroom() const { return 1; }
unsigned RavenSurface::sortRepairs() const { return 0; }
