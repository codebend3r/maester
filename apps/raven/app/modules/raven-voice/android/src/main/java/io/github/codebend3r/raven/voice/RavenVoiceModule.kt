package io.github.codebend3r.raven.voice

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.speech.RecognizerIntent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Any number of raven's own; only this module starts an activity for a result. */
private const val LISTEN_REQUEST = 7301

/**
 * Google TV's voice search. Google's text to speech app also answers the intent, so left open
 * the system asks which to use each time; asking the search app by name skips that.
 */
private const val GOOGLE_TV_VOICE = "com.google.android.katniss"

/**
 * Hears one answer through the system's speech recognizer (Google's on Android TV) and hands back
 * what it heard, or null when nothing was said, the listening was cancelled, or one is already
 * under way. The recognizer's own screen asks for the microphone, so the app needs no permission.
 */
class RavenVoiceModule : Module() {
  private var waiting: Promise? = null

  private fun recognizers(packages: PackageManager) =
    packages.queryIntentActivities(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), 0)

  override fun definition() = ModuleDefinition {
    Name("RavenVoice")

    /** Whether this device has a speech recognizer at all, so the app offers the button only where it works. */
    Function("isAvailable") {
      val packages = appContext.reactContext?.packageManager
      packages != null && recognizers(packages).isNotEmpty()
    }

    AsyncFunction("listen") { prompt: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || waiting != null) {
        // Off screen, or a second press while the recognizer is already up: the first keeps its answer.
        promise.resolve(null)
        return@AsyncFunction
      }
      val asked = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
        .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      val intent = Intent(asked).setPackage(GOOGLE_TV_VOICE)
        .takeIf { it.resolveActivity(activity.packageManager) != null } ?: asked
      try {
        waiting = promise
        activity.startActivityForResult(intent, LISTEN_REQUEST)
      } catch (error: ActivityNotFoundException) {
        waiting = null
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != LISTEN_REQUEST) return@OnActivityResult
      val promise = waiting ?: return@OnActivityResult
      waiting = null
      val heard = payload.data
        ?.takeIf { payload.resultCode == Activity.RESULT_OK }
        ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
        ?.firstOrNull()
      promise.resolve(heard)
    }
  }
}
