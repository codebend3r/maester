package expo.modules.ravenaudio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Records what each call did, in order, against a service named by a string. */
private class Calls {
  var log: List<String> = emptyList()
    private set

  fun pending(name: String) = Pending<String>(
    run = { service -> log = log + "$name on $service" },
    drop = { log = log + "$name dropped" },
  )
}

class ServiceGateTest {
  @Test
  fun aWindowWithNoServiceAsksToBindAndWaits() {
    val calls = Calls()
    val gate = ServiceGate<String>()

    val shouldBind = gate.submit(calls.pending("setWindow"), shouldBind = true)

    assertTrue(shouldBind)
    assertEquals(emptyList<String>(), calls.log)
  }

  @Test
  fun callsMadeWhileBindingRunInOrderOnceTheServiceIsUp() {
    val calls = Calls()
    val gate = ServiceGate<String>()
    gate.submit(calls.pending("setWindow"), shouldBind = true)

    val shouldBindAgain = gate.submit(calls.pending("setNext"), shouldBind = false)
    gate.submit(calls.pending("pause"), shouldBind = false)
    gate.submit(calls.pending("stop"), shouldBind = false)
    gate.attach("service")

    assertFalse(shouldBindAgain)
    assertEquals(
      listOf("setWindow on service", "setNext on service", "pause on service", "stop on service"),
      calls.log,
    )
  }

  @Test
  fun aSecondWindowWhileBindingDoesNotBindTwice() {
    val gate = ServiceGate<String>()
    val calls = Calls()
    gate.submit(calls.pending("first"), shouldBind = true)

    assertFalse(gate.submit(calls.pending("second"), shouldBind = true))
  }

  @Test
  fun aCallWithTheServiceUpRunsAtOnce() {
    val calls = Calls()
    val gate = ServiceGate<String>()
    gate.attach("service")

    val shouldBind = gate.submit(calls.pending("pause"), shouldBind = false)

    assertFalse(shouldBind)
    assertEquals(listOf("pause on service"), calls.log)
  }

  @Test
  fun aCallWithNoServiceAndNoWindowHasNothingToActOn() {
    val calls = Calls()
    val gate = ServiceGate<String>()

    val shouldBind = gate.submit(calls.pending("pause"), shouldBind = false)

    assertFalse(shouldBind)
    assertEquals(listOf("pause dropped"), calls.log)
  }

  @Test
  fun aFailedBindDropsWhatWaited() {
    val calls = Calls()
    val gate = ServiceGate<String>()
    gate.submit(calls.pending("setWindow"), shouldBind = true)
    gate.submit(calls.pending("pause"), shouldBind = false)

    gate.fail()
    gate.attach("late")

    assertEquals(listOf("setWindow dropped", "pause dropped"), calls.log)
  }

  @Test
  fun aServiceThatWentAwayIsBoundAgainByTheNextWindow() {
    val calls = Calls()
    val gate = ServiceGate<String>()
    gate.submit(calls.pending("setWindow"), shouldBind = true)
    gate.attach("first")

    gate.detach()
    val shouldBind = gate.submit(calls.pending("setWindow again"), shouldBind = true)
    gate.attach("second")

    assertTrue(shouldBind)
    assertEquals(listOf("setWindow on first", "setWindow again on second"), calls.log)
  }

  @Test
  fun aServiceArrivingUnaskedIsKeptForLaterCalls() {
    val calls = Calls()
    val gate = ServiceGate<String>()

    gate.attach("service")
    gate.submit(calls.pending("setWindow"), shouldBind = true)

    assertEquals(listOf("setWindow on service"), calls.log)
  }
}
