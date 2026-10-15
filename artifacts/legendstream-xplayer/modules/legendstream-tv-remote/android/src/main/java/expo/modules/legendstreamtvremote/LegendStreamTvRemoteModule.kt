package expo.modules.legendstreamtvremote

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.Window
import com.facebook.react.uimanager.UIManagerModule
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Native focus is authoritative, including Paper builds where RN drops JS focus events. */
class LegendStreamTvRemoteModule : Module() {
  private data class Entry(val tag: Int, val id: String, val scope: String, val region: String, val preferred: Boolean)
  private val targets = linkedMapOf<Int, Entry>()
  private val remembered = mutableMapOf<String, String>()
  private var activeScope = "content"
  private var catalogRootTag: Int? = null
  private var playerActive = false
  private var hidden = false
  private var original: Window.Callback? = null
  private var wrapper: Window.Callback? = null
  private var attachedWindow: Window? = null
  private var focusListener: ViewTreeObserver.OnGlobalFocusChangeListener? = null
  private val modalObservers = mutableMapOf<ViewTreeObserver, ViewTreeObserver.OnGlobalFocusChangeListener>()
  private var outlined: View? = null
  private var originalForeground: Drawable? = null
  private val consumed = mutableSetOf<Int>()

  private fun isTv(): Boolean {
    val activity = appContext.currentActivity ?: return false
    val mode = activity.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
    return mode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
  }
  private fun view(tag: Int): View? {
    // Dialog/Modal targets are registered in React UIManager but not Activity.findViewById.
    return try { appContext.reactContext?.getNativeModule(UIManagerModule::class.java)?.resolveView(tag)
      ?: appContext.currentActivity?.findViewById(tag) } catch (_: Exception) { appContext.currentActivity?.findViewById(tag) }
  }
  private fun watchModal(target: View) {
    val observer=target.viewTreeObserver
    if(observer===attachedWindow?.decorView?.viewTreeObserver || modalObservers.containsKey(observer)) return
    val listener=ViewTreeObserver.OnGlobalFocusChangeListener { _,next -> outline(next) }
    observer.addOnGlobalFocusChangeListener(listener);modalObservers[observer]=listener
  }
  private fun outline(next: View?) {
    if(next==null && outlined?.hasFocus()==true) return
    outlined?.foreground = originalForeground
    outlined = next
    originalForeground = next?.foreground
    if (next != null) {
      val density = next.resources.displayMetrics.density
      val dark=GradientDrawable().apply {
        setColor(Color.TRANSPARENT);setStroke((8*density).toInt(),Color.BLACK);cornerRadius=10*density
      }
      val light=GradientDrawable().apply {
        setColor(Color.TRANSPARENT);setStroke((4*density).toInt(),Color.WHITE);cornerRadius=10*density
      }
      next.foreground = LayerDrawable(arrayOf(dark,light))
    }
    val entry = next?.let { targets[it.id] }
    if(entry!=null) remembered[entry.scope]=entry.id
    sendEvent("onNativeFocus", mapOf("tag" to (next?.id ?: -1), "id" to (entry?.id ?: "")))
  }
  private fun focus(entry: Entry): Boolean {
    if(entry.scope!=activeScope) return false
    val target=view(entry.tag) ?: return false
    if(!target.isAttachedToWindow || !target.isShown || !target.isEnabled) return false
    target.requestRectangleOnScreen(Rect(0,0,target.width,target.height),false)
    val focused=target.requestFocus()
    if(focused) outline(target)
    return focused
  }
  private fun restore() {
    val id=remembered[activeScope]
    val entry=targets.values.firstOrNull { it.scope==activeScope && it.id==id }
      ?: targets.values.firstOrNull { it.scope==activeScope && it.preferred }
    if(entry!=null) attachedWindow?.decorView?.postDelayed({ if(entry.scope==activeScope) focus(entry) },32)
  }
  private fun move(direction: String): Boolean {
    val currentView=attachedWindow?.currentFocus ?: return false
    val current=targets[currentView.id] ?: return false
    fun measured(entry: Entry): TvFocusPolicy.Target? {
      val v=view(entry.tag) ?: return null
      if(!v.isAttachedToWindow || !v.isShown || !v.isEnabled || v.width<=0 || v.height<=0) return null
      val xy=IntArray(2);v.getLocationInWindow(xy)
      return TvFocusPolicy.Target(entry.tag,entry.id,entry.scope,entry.region,xy[0].toFloat(),xy[1].toFloat(),v.width.toFloat(),v.height.toFloat())
    }
    val currentRect=measured(current) ?: return true
    val candidates=targets.values.filter { it.scope==activeScope }.mapNotNull { measured(it) }
    val next=TvFocusPolicy.move(currentRect,direction,candidates,activeScope)
    if(next!=null) targets[next.tag]?.let { focus(it) }
    return true // A boundary retains the actual target; it never selects an arbitrary item.
  }
  private fun detach() {
    val window=attachedWindow
    if(window!=null && window.callback===wrapper) window.callback=original
    focusListener?.let { if(window?.decorView?.viewTreeObserver?.isAlive==true) window.decorView.viewTreeObserver.removeOnGlobalFocusChangeListener(it) }
    for((observer,listener) in modalObservers) if(observer.isAlive) observer.removeOnGlobalFocusChangeListener(listener)
    modalObservers.clear()
    outlined?.foreground=originalForeground
    outlined=null;originalForeground=null;focusListener=null;original=null;wrapper=null;attachedWindow=null;consumed.clear()
  }
  private fun attach(): Boolean {
    if(!isTv()) return false
    val window=appContext.currentActivity?.window ?: return false
    if(attachedWindow===window && window.callback===wrapper) return true
    detach()
    val previous=window.callback ?: return false
    original=previous;attachedWindow=window
    val listener=ViewTreeObserver.OnGlobalFocusChangeListener { _, next -> outline(next) }
    focusListener=listener;window.decorView.viewTreeObserver.addOnGlobalFocusChangeListener(listener)
    val callback=object: Window.Callback by previous {
      override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if(event.action==KeyEvent.ACTION_UP && consumed.remove(event.keyCode)) return true
        val direction=when(event.keyCode) {KeyEvent.KEYCODE_DPAD_LEFT->"left";KeyEvent.KEYCODE_DPAD_RIGHT->"right";KeyEvent.KEYCODE_DPAD_UP->"up";KeyEvent.KEYCODE_DPAD_DOWN->"down";else->null}
        val select=event.keyCode==KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode==KeyEvent.KEYCODE_ENTER
        if(event.action==KeyEvent.ACTION_DOWN && !(playerActive && hidden)) {
          if(direction!=null && move(direction)) {consumed.add(event.keyCode);return true}
          if(select) {
            val current=window.currentFocus
            val entry=current?.let {targets[it.id]}
            if(entry!=null && entry.scope==activeScope) {
              consumed.add(event.keyCode)
              if(event.repeatCount==0) current?.performClick()
              return true
            }
          }
        }
        val name=if(!playerActive) null else when(event.keyCode) {
          KeyEvent.KEYCODE_BACK->"back"
          KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,KeyEvent.KEYCODE_MEDIA_PLAY,KeyEvent.KEYCODE_MEDIA_PAUSE->"playPause"
          KeyEvent.KEYCODE_MEDIA_STOP->"stop"
          KeyEvent.KEYCODE_MEDIA_NEXT->"next"
          KeyEvent.KEYCODE_MEDIA_PREVIOUS->"previous"
          KeyEvent.KEYCODE_MENU->"menu"
          KeyEvent.KEYCODE_DPAD_CENTER,KeyEvent.KEYCODE_ENTER->if(hidden) "select" else null
          else->if(hidden) direction else null
        }
        if(name==null) return previous.dispatchKeyEvent(event)
        if(event.action==KeyEvent.ACTION_DOWN) {
          consumed.add(event.keyCode)
          if(event.repeatCount==0) sendEvent("onRemoteKey",mapOf("key" to name,"code" to event.keyCode))
        }
        return true
      }
    }
    wrapper=callback;window.callback=callback
    outline(window.currentFocus)
    return true
  }
  override fun definition()=ModuleDefinition {
    Name("LegendStreamTvRemote")
    Events("onRemoteKey","onNativeFocus")
    AsyncFunction("registerTarget") { tag: Int,id: String,scope: String,region: String,preferred: Boolean ->
      if(!attach()) return@AsyncFunction false
      targets[tag]=Entry(tag,id,scope,region,preferred)
      view(tag)?.let {watchModal(it)}
      if(attachedWindow?.currentFocus?.id==tag) outline(view(tag))
      val current=attachedWindow?.currentFocus?.let {targets[it.id]}
      if(scope==activeScope && current==null && (remembered[scope]==id || preferred)) restore()
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("unregisterTarget") { tag: Int -> targets.remove(tag);true }.runOnQueue(Queues.MAIN)
    AsyncFunction("requestTargetFocus") { tag: Int -> targets[tag]?.let {focus(it)} ?: false }.runOnQueue(Queues.MAIN)
    AsyncFunction("setScope") { scope: String ->
      if(!attach()) return@AsyncFunction false
      if(activeScope!=scope) {activeScope=scope;restore()}
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setFocusBlocked") { tag: Int,blocked: Boolean ->
      val group=view(tag) as? ViewGroup ?: return@AsyncFunction false
      if(catalogRootTag!=tag) {catalogRootTag=tag;remembered.remove("content")}
      group.descendantFocusability=if(blocked) ViewGroup.FOCUS_BLOCK_DESCENDANTS else ViewGroup.FOCUS_AFTER_DESCENDANTS
      if(blocked) group.clearFocus() else restore()
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("configure") { active: Boolean,controlsHidden: Boolean ->
      playerActive=active;hidden=controlsHidden
      attach()
    }.runOnQueue(Queues.MAIN)
    OnDestroy { appContext.currentActivity?.runOnUiThread {detach();targets.clear();remembered.clear()} }
  }
}
