package expo.modules.ravenaudio

/**
 * One call the app made: what it does on the service, how it settles if it never reaches one,
 * and how it settles when what it does throws.
 */
class Pending<S : Any>(val run: (S) -> Unit, val drop: () -> Unit, val fail: (Throwable) -> Unit)

/**
 * Holds the app's calls while the service the player lives in starts, and runs them on it in
 * the order they came, so each call's promise settles only once it took effect, as on iOS,
 * where the player is there from the start. Kept apart from Android so its rules run on the JVM.
 */
class ServiceGate<S : Any> {
  private var service: S? = null
  private var queued: List<Pending<S>> = emptyList()
  private var isBinding = false

  /**
   * Runs `pending` on the service, or holds it while one is starting. Only a call that opens a
   * window (`shouldBind`) starts one; any other with no service has nothing to act on and is
   * dropped. Answers whether the caller should bind the service now.
   */
  fun submit(pending: Pending<S>, shouldBind: Boolean): Boolean {
    val running = service
    if (running != null) {
      runOn(pending, running)
      return false
    }
    if (!isBinding && !shouldBind) {
      pending.drop()
      return false
    }
    queued = queued + pending
    if (isBinding) return false
    isBinding = true
    return true
  }

  /** The service is up: what waited runs on it, in order. */
  fun attach(running: S) {
    service = running
    isBinding = false
    val ready = queued
    queued = emptyList()
    ready.forEach { runOn(it, running) }
  }

  /**
   * A call that throws fails alone: `attach` runs from the service's `onCreate`, which an
   * exception would take down with every call queued behind it.
   */
  private fun runOn(pending: Pending<S>, running: S) {
    runCatching { pending.run(running) }.onFailure(pending.fail)
  }

  /** The service went away; the next window binds a new one. */
  fun detach() {
    service = null
    isBinding = false
  }

  /** The service could not be bound, or the module is going: what waited settles without it. */
  fun fail() {
    isBinding = false
    val dropped = queued
    queued = emptyList()
    dropped.forEach { it.drop() }
  }
}
