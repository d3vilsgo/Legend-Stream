package expo.modules.legendstreampip

import android.app.PictureInPictureParams
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.util.Rational
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToInt

class LegendStreamPipModule : Module() {
  private fun audioManager(): AudioManager? {
    val activity = appContext.currentActivity ?: return null
    return activity.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
  }

  override fun definition() = ModuleDefinition {
    Name("LegendStreamPip")

    Function("isSupported") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      val activity = appContext.currentActivity ?: return@Function false
      activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    }

    Function("isInPictureInPictureMode") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      appContext.currentActivity?.isInPictureInPictureMode == true
    }

    Function("getMediaVolume") {
      val audio = audioManager() ?: return@Function 1.0
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
      audio.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max.toDouble()
    }

    AsyncFunction("setMediaVolume") { value: Double ->
      val audio = audioManager() ?: return@AsyncFunction false
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
      val safe = value.coerceIn(0.0, 1.0)
      audio.setStreamVolume(
        AudioManager.STREAM_MUSIC,
        (safe * max.toDouble()).roundToInt().coerceIn(0, max),
        0
      )
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("enter") { width: Int, height: Int ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@AsyncFunction false
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
        return@AsyncFunction false
      }

      val safeWidth = width.coerceAtLeast(1)
      val safeHeight = height.coerceAtLeast(1)
      val rawRatio = safeWidth.toDouble() / safeHeight.toDouble()
      val aspectRatio = when {
        rawRatio > 2.39 -> Rational(239, 100)
        rawRatio < (1.0 / 2.39) -> Rational(100, 239)
        else -> Rational(safeWidth, safeHeight)
      }

      val params = PictureInPictureParams.Builder()
        .setAspectRatio(aspectRatio)
        .build()

      activity.enterPictureInPictureMode(params)
    }.runOnQueue(Queues.MAIN)
  }
}
