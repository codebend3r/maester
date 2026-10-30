#include <napi.h>
#include <uv.h>
#include <mpv/client.h>
#include "surface.h"
#include "nowplaying.h"
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

// Process-wide counts let native cleanup tests check reclamation across worker environments.
static std::atomic<unsigned> ownerCount{0};
static std::atomic<unsigned> callbackCount{0};
static std::atomic<unsigned> handleCount{0};

struct Player;
struct CleanupSignal {
    uv_async_t async;
    napi_async_cleanup_hook_handle hook;
    std::shared_ptr<Player> *owner;
};

struct Player {
    Player() { ++ownerCount; }
    ~Player() { --ownerCount; }
    mpv_handle *handle = nullptr;
    std::once_flag termination;
    napi_threadsafe_function callback = nullptr;
    std::mutex callbackMutex;
    bool hasCallbackReference = false;
    std::atomic<bool> isAlive{false};
    std::atomic<bool> isQueued{false};
    RavenSurface surface;
    RavenNowPlaying nowPlaying;
    // The system's transport commands, queued from the main thread until the next drain.
    std::mutex remoteMutex;
    std::vector<RavenRemoteCommand> remote;
    napi_async_cleanup_hook_handle cleanupHook = nullptr;
    std::shared_ptr<Player> *cleanupOwner = nullptr;
    uv_loop_t *loop = nullptr;
    std::chrono::steady_clock::time_point lastTime;

    static Napi::Value node(Napi::Env env, const mpv_node *value, unsigned depth = 0) {
        if (!value || depth > 32) return env.Null();
        switch (value->format) {
        case MPV_FORMAT_STRING: return Napi::String::New(env, value->u.string ? value->u.string : "");
        case MPV_FORMAT_FLAG: return Napi::Boolean::New(env, value->u.flag);
        case MPV_FORMAT_INT64: return Napi::Number::New(env, (double)value->u.int64);
        case MPV_FORMAT_DOUBLE: return Napi::Number::New(env, value->u.double_);
        case MPV_FORMAT_NODE_ARRAY: {
            auto list = value->u.list;
            auto result = Napi::Array::New(env, list->num);
            for (int i = 0; i < list->num; ++i) result.Set(i, node(env, &list->values[i], depth + 1));
            return result;
        }
        case MPV_FORMAT_NODE_MAP: {
            auto list = value->u.list;
            auto result = Napi::Object::New(env);
            for (int i = 0; i < list->num; ++i) result.Set(list->keys[i], node(env, &list->values[i], depth + 1));
            return result;
        }
        default: return env.Null();
        }
    }

    static void wake(void *data) {
        auto player = static_cast<Player *>(data);
        std::lock_guard<std::mutex> lock(player->callbackMutex);
        if (!player->isAlive || !player->hasCallbackReference || player->isQueued.exchange(true)) return;
        // No per-call allocation: Node also invokes receive with a null environment
        // when discarding queued work. The TSFN finalizer owns the context instead.
        napi_status status = napi_call_threadsafe_function(player->callback, nullptr, napi_tsfn_nonblocking);
        // napi_closing consumes this producer's reference during environment exit.
        if (status == napi_closing) player->hasCallbackReference = false;
        if (status != napi_ok) player->isQueued = false;
    }
    static void receive(napi_env env, napi_value callback, void *context, void *) {
        auto player = static_cast<Player *>(context);
        if (!env || !callback || !player->isAlive) return;
        try {
            player->drain(Napi::Env(env), Napi::Function(env, callback));
        } catch (const Napi::Error &error) {
            // Node calls this from C++ built without exceptions, so nothing may escape. While an
            // environment terminates, even rethrowing to JavaScript fails by throwing.
            try { error.ThrowAsJavaScriptException(); } catch (...) {}
        } catch (...) {}
    }
    static void finalizeCallback(napi_env, void *data, void *) {
        --callbackCount;
        delete static_cast<std::shared_ptr<Player> *>(data);
    }

    void onRemote(const RavenRemoteCommand &command) {
        {
            std::lock_guard<std::mutex> lock(remoteMutex);
            remote.push_back(command);
        }
        wake(this);
    }
    void drainRemote(Napi::Env env, Napi::Function receive) {
        std::vector<RavenRemoteCommand> commands;
        {
            std::lock_guard<std::mutex> lock(remoteMutex);
            commands.swap(remote);
        }
        for (auto &command : commands) {
            if (!isAlive) return;
            auto result = Napi::Object::New(env);
            result.Set("type", "remote");
            result.Set("command", command.name);
            if (command.name == "seek") result.Set("time", command.time);
            receive.Call({result});
            if (env.IsExceptionPending()) return;
        }
    }

    void drain(Napi::Env env, Napi::Function receive) {
        isQueued = false;
        drainRemote(env, receive);
        if (env.IsExceptionPending()) return;
        // Bound a turn so a busy decoder cannot monopolize Electron's main loop.
        for (int i = 0; i < 256 && isAlive; ++i) {
            mpv_event *event = mpv_wait_event(handle, 0);
            if (event->event_id == MPV_EVENT_NONE) return;
            auto result = Napi::Object::New(env);
            switch (event->event_id) {
            case MPV_EVENT_COMMAND_REPLY:
            case MPV_EVENT_GET_PROPERTY_REPLY:
            case MPV_EVENT_SET_PROPERTY_REPLY: {
                result.Set("type", "reply");
                result.Set("id", (double)event->reply_userdata);
                result.Set("error", event->error);
                Napi::Value value = env.Null();
                if (event->error >= 0 && event->event_id == MPV_EVENT_GET_PROPERTY_REPLY) {
                    auto property = static_cast<mpv_event_property *>(event->data);
                    if (property->format == MPV_FORMAT_NODE) value = node(env, static_cast<mpv_node *>(property->data));
                }
                result.Set("data", value);
                break;
            }
            case MPV_EVENT_PROPERTY_CHANGE: {
                auto property = static_cast<mpv_event_property *>(event->data);
                if (strcmp(property->name, "time-pos") == 0) {
                    auto now = std::chrono::steady_clock::now();
                    if (now - lastTime < std::chrono::milliseconds(250)) continue;
                    lastTime = now;
                }
                result.Set("type", "property");
                result.Set("name", property->name);
                result.Set("data", property->format == MPV_FORMAT_NODE
                    ? node(env, static_cast<mpv_node *>(property->data)) : env.Null());
                break;
            }
            case MPV_EVENT_END_FILE: {
                auto end = static_cast<mpv_event_end_file *>(event->data);
                result.Set("type", "end-file");
                result.Set("reason", end->reason == MPV_END_FILE_REASON_EOF ? "eof" :
                    end->reason == MPV_END_FILE_REASON_ERROR ? "error" :
                    end->reason == MPV_END_FILE_REASON_STOP ? "stop" :
                    end->reason == MPV_END_FILE_REASON_QUIT ? "quit" : "redirect");
                result.Set("error", end->error);
                break;
            }
            case MPV_EVENT_LOG_MESSAGE: {
                auto log = static_cast<mpv_event_log_message *>(event->data);
                result.Set("type", "log");
                result.Set("prefix", log->prefix);
                result.Set("level", log->level);
                result.Set("text", log->text);
                break;
            }
            case MPV_EVENT_FILE_LOADED: result.Set("type", "file-loaded"); break;
            case MPV_EVENT_PLAYBACK_RESTART: result.Set("type", "playback-restart"); break;
            case MPV_EVENT_SHUTDOWN: result.Set("type", "shutdown"); break;
            case MPV_EVENT_QUEUE_OVERFLOW: result.Set("type", "overflow"); break;
            default: continue;
            }
            receive.Call({result});
            if (env.IsExceptionPending()) return;
        }
        wake(this);
    }

    // Under the callback lock, so once this returns no wake() is between its isAlive check
    // and its call into the TSFN.
    void disconnect() {
        std::lock_guard<std::mutex> lock(callbackMutex);
        isAlive = false;
    }
    void releaseCallback() {
        std::lock_guard<std::mutex> lock(callbackMutex);
        if (!hasCallbackReference) return;
        hasCallbackReference = false;
        napi_release_threadsafe_function(callback, napi_tsfn_abort);
    }
    void terminate() {
        std::call_once(termination, [this] {
            // Before mpv goes: a remote command landing after would wake nothing.
            nowPlaying.stop();
            if (handle) {
                // mpv unregistration takes its wakeup lock and joins any producer
                // already inside wake(). Keep the TSFN reference until then.
                mpv_set_wakeup_callback(handle, nullptr, nullptr);
                mpv_terminate_destroy(handle);
                handle = nullptr;
                --handleCount;
            }
            releaseCallback();
        });
    }
    void removeCleanupHook() {
        if (!cleanupHook) return;
        napi_remove_async_cleanup_hook(cleanupHook);
        cleanupHook = nullptr;
        delete cleanupOwner;
        cleanupOwner = nullptr;
    }
    static void cleanup(napi_async_cleanup_hook_handle hook, void *data) {
        auto owner = static_cast<std::shared_ptr<Player> *>(data);
        auto player = *owner;
        player->disconnect();
        // Let go of the TSFN here, on the loop thread, while the environment still owns it.
        // Node's own cleanup hook frees the TSFN while the engine terminates on its thread,
        // so a release from there would touch freed memory: an access violation on Windows.
        player->releaseCallback();
        // Removing the hook updates Node's exit counters and immediate queue, which only the
        // loop thread may touch: from the terminating thread it can hang or abort exit. The
        // engine terminates off the loop, then this handle wakes the loop to finish there.
        auto signal = new CleanupSignal{{}, hook, owner};
        if (uv_async_init(player->loop, &signal->async, signalCleanup) != 0) {
            delete signal;
            player->terminate();
            finishCleanup(hook, owner);
            return;
        }
        signal->async.data = signal;
        std::thread([player, signal] {
            player->terminate();
            uv_async_send(&signal->async);
        }).detach();
    }
    static void signalCleanup(uv_async_t *async) {
        uv_close(reinterpret_cast<uv_handle_t *>(async), [](uv_handle_t *handle) {
            auto signal = static_cast<CleanupSignal *>(handle->data);
            finishCleanup(signal->hook, signal->owner);
            delete signal;
        });
    }
    static void finishCleanup(napi_async_cleanup_hook_handle hook, std::shared_ptr<Player> *owner) {
        (*owner)->surface.detach();
        napi_remove_async_cleanup_hook(hook);
        delete owner;
    }
};

class DestroyWorker : public Napi::AsyncWorker {
    std::shared_ptr<Player> player;
    Napi::Promise::Deferred deferred;
public:
    DestroyWorker(Napi::Env env, std::shared_ptr<Player> owner)
        : Napi::AsyncWorker(env), player(owner), deferred(Napi::Promise::Deferred::New(env)) {}
    Napi::Promise promise() { return deferred.Promise(); }
    void Execute() override { player->terminate(); }
    void OnOK() override {
        player->surface.detach();
        deferred.Resolve(Env().Undefined());
    }
    void OnError(const Napi::Error &error) override { deferred.Reject(error.Value()); }
};

static void check(Napi::Env env, int error) {
    if (error < 0) throw Napi::Error::New(env, mpv_error_string(error));
}
static std::string stringArg(const Napi::Value &value) {
    if (!value.IsString()) throw Napi::TypeError::New(value.Env(), "Expected string");
    auto result = value.As<Napi::String>().Utf8Value();
    if (result.find('\0') != std::string::npos) throw Napi::TypeError::New(value.Env(), "NUL in string");
    return result;
}

class NativePlayer : public Napi::ObjectWrap<NativePlayer> {
    std::shared_ptr<Player> player;
    Napi::Reference<Napi::Promise> destruction;
    mpv_handle *active(Napi::Env env) {
        if (!player || !player->isAlive) throw Napi::Error::New(env, "mpv is destroyed");
        return player->handle;
    }
    uint64_t requestId(const Napi::Value &value) {
        if (!value.IsNumber()) throw Napi::TypeError::New(value.Env(), "Expected request id");
        double id = value.As<Napi::Number>().DoubleValue();
        if (!std::isfinite(id) || id < 1 || id > 9007199254740991.0 || std::floor(id) != id)
            throw Napi::TypeError::New(value.Env(), "Invalid request id");
        return (uint64_t)id;
    }
public:
    NativePlayer(const Napi::CallbackInfo &info) : Napi::ObjectWrap<NativePlayer>(info) {
        auto env = info.Env();
        if (info.Length() != 2 || !info[0].IsObject() || !info[1].IsFunction())
            throw Napi::TypeError::New(env, "Expected surface and callback");
        player = std::make_shared<Player>();
        auto surface = info[0].As<Napi::Object>();
        auto kind = stringArg(surface.Get("kind"));
        if (kind == "window") {
            auto handle = surface.Get("handle");
            if (!handle.IsBuffer()) throw Napi::TypeError::New(env, "Expected native window handle");
            auto buffer = handle.As<Napi::Buffer<uint8_t>>();
            if (buffer.Length() != sizeof(void *)) throw Napi::TypeError::New(env, "Invalid native window handle size");
            void *view = nullptr;
            memcpy(&view, buffer.Data(), sizeof(view));
            if (!view) throw Napi::TypeError::New(env, "Empty native window handle");
            try { player->surface.attach(view); }
            catch (const std::exception &error) { throw Napi::Error::New(env, error.what()); }
        } else if (kind != "headless" && kind != "audio") throw Napi::TypeError::New(env, "Unknown surface kind");
        player->handle = mpv_create();
        if (!player->handle) {
            player->surface.detach();
            throw Napi::Error::New(env, "mpv_create failed");
        }
        ++handleCount;
        try {
            auto option = [&](const char *name, const char *value) { check(env, mpv_set_option_string(player->handle, name, value)); };
            option("config", "no");
            option("load-scripts", "no");
            option("ytdl", "no");
            option("osc", "no");
            option("input-default-bindings", "no");
            option("input-vo-keyboard", "no");
            option("terminal", "no");
            option("idle", "yes");
            option("hwdec", "auto");
            option("video-sync", "display-resample");
            option("target-colorspace-hint", "no");
            option("hdr-compute-peak", "yes");
            option("cache", "yes");
            option("demuxer-max-bytes", "1073741824");
            option("demuxer-max-back-bytes", "268435456");
            option("audio-channels", "auto-safe");
            if (kind == "headless") {
                option("vo", "null");
                option("ao", "null");
            } else if (kind == "audio") {
                // Sound alone: no window, no video decoding, the tracks run together and sit at
                // the album's loudness. The host picks the audio output, as for a window.
                option("vo", "null");
                option("vid", "no");
                option("force-window", "no");
                option("audio-display", "no");
                option("gapless-audio", "yes");
                option("replaygain", "album");
                // Raven owns the media keys through Now Playing; the option exists on macOS alone,
                // so a build without it is left as it is.
                mpv_set_option_string(player->handle, "input-media-keys", "no");
            } else {
                option("vo", "gpu-next");
                option("gpu-api", player->surface.gpuApi());
                if (auto context = player->surface.gpuContext()) option("gpu-context", context);
                int64_t wid = player->surface.wid();
                check(env, mpv_set_option(player->handle, "wid", MPV_FORMAT_INT64, &wid));
            }
            check(env, mpv_initialize(player->handle));
            check(env, mpv_request_log_messages(player->handle, "warn"));
        } catch (...) {
            auto owner = player;
            auto worker = new DestroyWorker(env, owner);
            worker->Queue();
            throw;
        }
        auto callbackOwner = new std::shared_ptr<Player>(player);
        napi_status callbackStatus = napi_create_threadsafe_function(env, info[1], nullptr,
            Napi::String::New(env, "raven mpv events"), 1, 1, callbackOwner,
            Player::finalizeCallback, player.get(), Player::receive, &player->callback);
        if (callbackStatus != napi_ok) {
            delete callbackOwner;
            auto worker = new DestroyWorker(env, player);
            worker->Queue();
            throw Napi::Error::New(env, "Cannot create mpv event callback");
        }
        ++callbackCount;
        player->hasCallbackReference = true;
        napi_unref_threadsafe_function(env, player->callback);
        player->isAlive = true;
        player->cleanupOwner = new std::shared_ptr<Player>(player);
        if (napi_get_uv_event_loop(env, &player->loop) != napi_ok ||
            napi_add_async_cleanup_hook(env, Player::cleanup, player->cleanupOwner, &player->cleanupHook) != napi_ok) {
            delete player->cleanupOwner;
            player->cleanupOwner = nullptr;
            player->disconnect();
            auto worker = new DestroyWorker(env, player);
            worker->Queue();
            throw Napi::Error::New(env, "Cannot register async mpv cleanup");
        }
        mpv_set_wakeup_callback(player->handle, Player::wake, player.get());
        if (kind == "audio") {
            // The handlers keep the owner alive until stop(), which terminate() runs.
            auto owner = player;
            player->nowPlaying.listen([owner](const RavenRemoteCommand &command) { owner->onRemote(command); });
        }
    }
    ~NativePlayer() {
        if (!player || !player->isAlive) return;
        player->disconnect();
        // A GC finalizer must not create JS promises or AsyncWorker objects. Keep
        // the async environment hook as the owner until exit, so exit also waits
        // for an abandoned engine's termination. call_once joins concurrent cleanup.
        auto owner = player;
        std::thread([owner] {
            owner->terminate();
            owner->surface.detachFromAnyThread();
        }).detach();
    }
    void command(const Napi::CallbackInfo &info) {
        auto handle = active(info.Env());
        auto id = requestId(info[0]);
        if (!info[1].IsArray()) throw Napi::TypeError::New(info.Env(), "Expected command arguments");
        auto args = info[1].As<Napi::Array>();
        if (args.Length() == 0 || args.Length() > 256) throw Napi::TypeError::New(info.Env(), "Invalid command argument count");
        std::vector<std::string> strings;
        for (uint32_t i = 0; i < args.Length(); ++i) strings.push_back(stringArg(args.Get(i)));
        std::vector<const char *> pointers;
        for (auto &s : strings) pointers.push_back(s.c_str());
        pointers.push_back(nullptr);
        check(info.Env(), mpv_command_async(handle, id, pointers.data()));
    }
    void get(const Napi::CallbackInfo &info) {
        auto handle = active(info.Env());
        auto name = stringArg(info[1]);
        check(info.Env(), mpv_get_property_async(handle, requestId(info[0]), name.c_str(), MPV_FORMAT_NODE));
    }
    void set(const Napi::CallbackInfo &info) {
        auto handle = active(info.Env());
        auto id = requestId(info[0]);
        auto name = stringArg(info[1]);
        auto value = info[2];
        if (value.IsString()) {
            auto text = stringArg(value);
            char *pointer = text.data();
            check(info.Env(), mpv_set_property_async(handle, id, name.c_str(), MPV_FORMAT_STRING, &pointer));
        } else if (value.IsBoolean()) {
            int flag = value.As<Napi::Boolean>().Value();
            check(info.Env(), mpv_set_property_async(handle, id, name.c_str(), MPV_FORMAT_FLAG, &flag));
        } else if (value.IsNumber() && std::isfinite(value.As<Napi::Number>().DoubleValue())) {
            double number = value.As<Napi::Number>().DoubleValue();
            if (std::floor(number) == number && std::abs(number) <= 9007199254740991.0) {
                int64_t integer = (int64_t)number;
                check(info.Env(), mpv_set_property_async(handle, id, name.c_str(), MPV_FORMAT_INT64, &integer));
            } else {
                check(info.Env(), mpv_set_property_async(handle, id, name.c_str(), MPV_FORMAT_DOUBLE, &number));
            }
        } else throw Napi::TypeError::New(info.Env(), "Invalid property value");
    }
    void observe(const Napi::CallbackInfo &info) {
        auto name = stringArg(info[0]);
        check(info.Env(), mpv_observe_property(active(info.Env()), 0, name.c_str(), MPV_FORMAT_NODE));
    }
    Napi::Value destroy(const Napi::CallbackInfo &info) {
        if (!destruction.IsEmpty()) return destruction.Value();
        player->disconnect();
        player->removeCleanupHook();
        auto worker = new DestroyWorker(info.Env(), player);
        auto promise = worker->promise();
        destruction = Napi::Persistent(promise);
        worker->Queue();
        return promise;
    }
    void nowPlaying(const Napi::CallbackInfo &info) {
        active(info.Env());
        if (!info[0].IsObject()) throw Napi::TypeError::New(info.Env(), "Expected now playing info");
        auto value = info[0].As<Napi::Object>();
        RavenNowPlayingInfo parsed;
        parsed.title = stringArg(value.Get("title"));
        parsed.artist = stringArg(value.Get("artist"));
        parsed.album = stringArg(value.Get("album"));
        auto number = [&](const char *name) {
            auto field = value.Get(name);
            if (!field.IsNumber()) throw Napi::TypeError::New(info.Env(), "Expected a number");
            double result = field.As<Napi::Number>().DoubleValue();
            return std::isfinite(result) && result >= 0 ? result : 0.0;
        };
        parsed.duration = number("duration");
        parsed.position = number("position");
        auto playing = value.Get("isPlaying");
        if (!playing.IsBoolean()) throw Napi::TypeError::New(info.Env(), "Expected isPlaying");
        parsed.isPlaying = playing.As<Napi::Boolean>().Value();
        auto artwork = value.Get("artwork");
        if (artwork.IsBuffer()) {
            auto buffer = artwork.As<Napi::Buffer<uint8_t>>();
            parsed.artwork.assign(buffer.Data(), buffer.Data() + buffer.Length());
        } else if (!artwork.IsNull()) throw Napi::TypeError::New(info.Env(), "Expected artwork bytes or null");
        player->nowPlaying.set(parsed);
    }
    void clearNowPlaying(const Napi::CallbackInfo &) {
        if (!player) return;
        player->nowPlaying.clear();
    }
    Napi::Value display(const Napi::CallbackInfo &info) {
        active(info.Env());
        auto result = Napi::Object::New(info.Env());
        result.Set("refreshRate", player->surface.refreshRate());
        result.Set("edrHeadroom", player->surface.edrHeadroom());
        result.Set("sortRepairs", (double)player->surface.sortRepairs());
        return result;
    }
    static Napi::Object init(Napi::Env env, Napi::Object exports) {
        auto constructor = DefineClass(env, "NativePlayer", {
            InstanceMethod("command", &NativePlayer::command), InstanceMethod("get", &NativePlayer::get),
            InstanceMethod("set", &NativePlayer::set), InstanceMethod("observe", &NativePlayer::observe),
            InstanceMethod("destroy", &NativePlayer::destroy), InstanceMethod("display", &NativePlayer::display),
            InstanceMethod("nowPlaying", &NativePlayer::nowPlaying),
            InstanceMethod("clearNowPlaying", &NativePlayer::clearNowPlaying),
        });
        auto reference = new Napi::FunctionReference(Napi::Persistent(constructor));
        env.AddCleanupHook([](Napi::FunctionReference *ref) { delete ref; }, reference);
        exports.Set("create", Napi::Function::New(env, [reference](const Napi::CallbackInfo &info) {
            return reference->New({info[0], info[1]});
        }));
        exports.Set("lifecycleCounts", Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
            auto counts = Napi::Object::New(info.Env());
            counts.Set("owners", ownerCount.load());
            counts.Set("callbacks", callbackCount.load());
            counts.Set("handles", handleCount.load());
            return counts;
        }));
        exports.Set("apiVersion", (double)mpv_client_api_version());
        return exports;
    }
};

static Napi::Object init(Napi::Env env, Napi::Object exports) { return NativePlayer::init(env, exports); }
NODE_API_MODULE(raven_mpv, init)
