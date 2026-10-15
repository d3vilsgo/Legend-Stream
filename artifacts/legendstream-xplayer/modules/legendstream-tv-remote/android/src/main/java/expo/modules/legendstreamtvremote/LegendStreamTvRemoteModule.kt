package expo.modules.legendstreamtvremote

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.Window
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Leaves visible-control D-pad navigation to Android FocusFinder. Back has one JS owner. */
class LegendStreamTvRemoteModule : Module() {
  private var original: Window.Callback? = null
  private var wrapper: Window.Callback? = null
  private var attachedWindow: Window? = null
  private var hidden = false

  private fun detach() {
    val window = attachedWindow
    if (window?.callback === wrapper) window.callback = original
    original = null
    wrapper = null
    attachedWindow = null
  }

  override fun definition() = ModuleDefinition {
    Name("LegendStreamTvRemote")
    Events("onRemoteKey")
    AsyncFunction("setFocusBlocked") { tag: Int, blocked: Boolean ->
      val group = appContext.currentActivity?.findViewById<ViewGroup>(tag) ?: return@AsyncFunction false
      group.descendantFocusability = if (blocked) ViewGroup.FOCUS_BLOCK_DESCENDANTS else ViewGroup.FOCUS_AFTER_DESCENDANTS
      if (blocked) group.clearFocus()
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("configure") { active: Boolean, controlsHidden: Boolean ->
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      val mode = activity.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
      if (mode?.currentModeType != Configuration.UI_MODE_TYPE_TELEVISION) return@AsyncFunction false
      hidden = controlsHidden
      if (!active) { detach(); return@AsyncFunction true }
      if (attachedWindow === activity.window && activity.window.callback === wrapper) return@AsyncFunction true
      detach()
      val previous = activity.window.callback ?: return@AsyncFunction false
      val consumed = mutableSetOf<Int>()
      val callback = object : Window.Callback by previous {
        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
          if (event.action == KeyEvent.ACTION_UP && consumed.remove(event.keyCode)) return true
          val name = when (event.keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> "playPause"
            KeyEvent.KEYCODE_MEDIA_STOP -> "stop"
            KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "previous"
            KeyEvent.KEYCODE_MENU -> "menu"
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> if (hidden) "select" else null
            KeyEvent.KEYCODE_DPAD_LEFT -> if (hidden) "left" else null
            KeyEvent.KEYCODE_DPAD_RIGHT -> if (hidden) "right" else null
            KeyEvent.KEYCODE_DPAD_UP -> if (hidden) "up" else null
            KeyEvent.KEYCODE_DPAD_DOWN -> if (hidden) "down" else null
            else -> null
          }
          if (name == null) return previous.dispatchKeyEvent(event)
          if (event.action == KeyEvent.ACTION_DOWN) consumed.add(event.keyCode)
          if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            sendEvent("onRemoteKey", mapOf("key" to name, "code" to event.keyCode))
          }
          return true
        }
      }
      original = previous
      wrapper = callback
      attachedWindow = activity.window
      activity.window.callback = callback
      true
    }.runOnQueue(Queues.MAIN)
    OnDestroy { appContext.currentActivity?.runOnUiThread { detach() } }
  }
}
