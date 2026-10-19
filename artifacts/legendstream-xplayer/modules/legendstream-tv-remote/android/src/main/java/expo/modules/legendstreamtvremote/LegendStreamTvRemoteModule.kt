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
import android.widget.EditText
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Native focus is authoritative, including Paper builds where RN drops JS focus events. */
class LegendStreamTvRemoteModule : Module() {
  private data class Entry(val tag: Int, val id: String, val scope: String, val region: String, val preferred: Boolean)
  private val targets = linkedMapOf<Int, Entry>()
  private val legacyTargets = linkedMapOf<Int, Entry>()
  private fun entries(): List<Entry> = targets.values.toList()+legacyTargets.values.filter { !targets.containsKey(it.tag) }
  private val remembered = mutableMapOf<String, String>()
  private var lastContent: Entry? = null
  private var lastContentRegion: String? = null
  private var dispatchDurationMs = 0.0
  private var activeScope = "content"
  private var catalogRootTag: Int? = null
  private var inspectorEnabled = false
  private var inspectorSequence = 0
  private var inspectorSalt = java.util.UUID.randomUUID().toString()
  private fun safeId(tag: Int, raw: String): String {
    val fixed = setOf("nav:home","nav:live","nav:movies","nav:series","nav:settings","nav:history","nav:downloads","player:play-pause","player:exit","player:channels","player:audio","player:subtitles","player:codec")
    if(raw in fixed) return raw.replace("nav:","navigation:")
    val actionAliases=mapOf("list" to "channels","cc" to "subtitles","audio" to "audio","codec" to "codec","fit" to "aspect","previous" to "previous","next" to "next","pip" to "pip","download" to "download")
    if(raw.startsWith("player:action:")) actionAliases[raw.removePrefix("player:action:")]?.let {return "player:$it"}
    if(raw=="player:panel-close") return "player:panel-close"
    val families=mapOf("home-hero:" to "home:hero","home-shelf:" to "home:shelf","home:" to "home:section","live-favorite:" to "catalog:favorite","live:" to "catalog:channel","vod:" to "catalog:movie","series:" to "catalog:series","season:" to "catalog:season","episode:" to "catalog:episode","category-drawer:item:" to "catalog:category")
    families.entries.firstOrNull {raw.startsWith(it.key)}?.let {
      val digest=java.security.MessageDigest.getInstance("SHA-256").digest((inspectorSalt+raw).toByteArray(Charsets.UTF_8))
      return it.value+":"+java.math.BigInteger(1,digest.copyOfRange(0,4)).toString()
    }
    if(raw in setOf("catalog:categories","catalog:sort","category-drawer:close"))return raw
    val source=if(raw.isEmpty()) "native:$tag" else raw
    val digest=java.security.MessageDigest.getInstance("SHA-256").digest((inspectorSalt+source).toByteArray(Charsets.UTF_8))
    return "target:"+java.math.BigInteger(1,digest.copyOfRange(0,8)).toString()
  }
  private fun diagnostic(kind: String, key: String = "", phase: String = "", handled: Boolean = false) {
    if(!inspectorEnabled) return
    val current=actualFocus()
    val entry=current?.let {targets[it.id] ?: legacyTargets[it.id]}
    sendEvent("onInspector",mapOf("timeMs" to now(),"dispatchDurationMs" to dispatchDurationMs,"inputAgeMs" to (if(lastInputAt<0) -1L else now()-lastInputAt),"beforeFocus" to focusBefore,"cause" to focusCause,"withoutInput" to withoutInput,"delivery" to delivery,"dispatchOwner" to dispatchOwner,"expectedFocus" to expectedFocus,"moveOutcome" to moveOutcome,"expectedVisible" to expectedVisible,"focusTop" to (current?.let {val xy=IntArray(2);it.getLocationInWindow(xy);xy[1]/it.resources.displayMetrics.density} ?: -1f),"kind" to kind,"sequence" to inspectorSequence,"key" to key,"phase" to phase,"handled" to handled,"focus" to (entry?.let {safeId(it.tag,it.id)} ?: if(current!=null) safeId(current.id,"") else "none"),"scope" to (if(activeScope in setOf("content","player","player-panel:content","player-panel:audio","player-panel:subtitles","player-panel:codec")) activeScope else "modal"),"context" to (if(playerActive) if(hidden) "player-hidden" else "player-controls" else "catalog")))
  }
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
  private val stability=TvFocusStability()
  private var pendingRestore:Runnable?=null
  private var requestedCause=""
  private var dispatchingInput=false
  private var delivery="fresh"
  private var lastInputAt=-1L
  private var lastStructureAt=-1L
  private var lastStructure="layout"
  private var observedFocusId="none"
  private var focusBefore="none"
  private var focusCause="snapshot"
  private var withoutInput=false
  private var expectedFocus="none"
  private var moveOutcome="not-directional"
  private var expectedVisible=true
  private var dispatchOwner="window-delegate"
  private var layoutListener:ViewTreeObserver.OnGlobalLayoutListener?=null
  private fun now()=android.os.SystemClock.elapsedRealtime()
  private fun structural(reason:String){if(reason=="layout"&&lastStructure!="layout"&&now()-lastStructureAt<=100)return;lastStructure=reason;lastStructureAt=now()}
  private fun cancelRestore(){stability.invalidate();pendingRestore?.let {attachedWindow?.decorView?.removeCallbacks(it)};pendingRestore=null}
  private fun actualFocus():View? = inspectedWindows.keys.asSequence().mapNotNull {it.currentFocus}
    .firstOrNull {v -> targets[v.id]?.scope==activeScope && v.isAttachedToWindow}
    ?: outlined?.takeIf {it.hasFocus() && it.isAttachedToWindow} ?: attachedWindow?.currentFocus
  private fun hasActiveFocus():Boolean {
    val current=actualFocus() ?: return false
    val entry=targets[current.id] ?: legacyTargets[current.id]
    if(entry!=null)return entry.scope==activeScope && current.isShown && current.isEnabled
    if(activeScope!="content" || !(current.isClickable || current is EditText))return false
    var ancestor:android.view.ViewParent?=current.parent
    while(ancestor!=null){if((ancestor as? View)?.id==catalogRootTag)return true;ancestor=ancestor.parent}
    return false
  }
  private fun anonymousFocus(v:View?):String {
    if(v==null)return "none"
    val entry=targets[v.id] ?: legacyTargets[v.id]
    return safeId(v.id,entry?.id ?: "")
  }

  private fun isTv(): Boolean {
    val activity = appContext.currentActivity ?: return false
    val mode = activity.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
    return mode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
  }
  private fun view(tag: Int): View? {
    // Dialog/Modal targets are registered in React UIManager but not Activity.findViewById.
    return try { appContext.findView<View>(tag)
      ?: appContext.currentActivity?.findViewById(tag) } catch (_: Exception) { appContext.currentActivity?.findViewById(tag) }
  }
  private fun watchModal(target: View) {
    inspectDialogs(attachedWindow?.decorView)
    val observer=target.viewTreeObserver
    if(observer===attachedWindow?.decorView?.viewTreeObserver || modalObservers.containsKey(observer)) return
    val listener=ViewTreeObserver.OnGlobalFocusChangeListener { _,next -> outline(next) }
    observer.addOnGlobalFocusChangeListener(listener);modalObservers[observer]=listener
  }
  private fun outline(next: View?) {
    if(next==null && outlined?.hasFocus()==true) return
    if(next===outlined)return
    focusBefore=observedFocusId
    focusCause=TvFocusStability.cause(requestedCause,dispatchingInput,if(lastStructureAt<0) -1L else now()-lastStructureAt,lastStructure)
    withoutInput=!dispatchingInput && (lastInputAt<0 || now()-lastInputAt>150)
    cancelRestore()
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
    val entry = next?.let { targets[it.id] ?: legacyTargets[it.id] }
    if(entry!=null) {
      remembered[entry.scope]=entry.id
      if(entry.scope=="content" && entry.region!="navigation" && entry.scope==activeScope && next?.isAttachedToWindow==true && next.isShown) {
        lastContent=entry
        if(entry.region in setOf("home","live","movies","series")) lastContentRegion=entry.region
      }
    }
    observedFocusId=anonymousFocus(next)
    diagnostic("focus")
    sendEvent("onNativeFocus", mapOf("tag" to (next?.id ?: -1), "id" to (entry?.id ?: "")))
  }
  private fun focus(entry: Entry,cause:String="explicit-restore"): Boolean {
    if(entry.scope!=activeScope) return false
    val target=view(entry.tag) ?: return false
    if(!target.isAttachedToWindow || !target.isShown || !target.isEnabled) return false
    target.requestRectangleOnScreen(Rect(0,0,target.width,target.height),cause=="native-input")
    val previousCause=requestedCause;requestedCause=cause
    try {
      val focused=target.requestFocus()
      if(focused && target.hasFocus())outline(target)
      return focused
    } finally {requestedCause=previousCause}
  }
  private fun restore(reason:String="scope-restore") {
    if(hasActiveFocus())return
    pendingRestore?.let {attachedWindow?.decorView?.removeCallbacks(it)}
    val id=remembered[activeScope]
    fun valid(entry:Entry)=entry.scope==activeScope && view(entry.tag)?.let {it.isAttachedToWindow && it.isShown && it.isEnabled}==true
    // Missing remembered item waits for its mount; no arbitrary preferred fallback.
    val entry=if(id!=null) entries().firstOrNull {it.id==id&&valid(it)} else entries().firstOrNull {it.preferred&&valid(it)}
    if(entry==null)return
    val ticket=stability.schedule()
    val task=Runnable {
      pendingRestore=null
      val same=targets[entry.tag]?.let {it.id==entry.id&&it.scope==activeScope}==true
      if(stability.canRestore(ticket,hasActiveFocus(),same&&valid(entry)))focus(entry,reason)
    }
    pendingRestore=task;view(entry.tag)?.post(task)
  }
  private fun move(direction: String): Boolean {
    expectedFocus="none";moveOutcome="missing-focus";expectedVisible=true
    val currentView=actualFocus() ?: run {restore("explicit-restore");return true}
    if(activeScope=="content") {
      // Retain native access to legacy Pressables and EditTexts (search/settings/EPG).
      // Primary catalog rows/cards keep their explicit semantic IDs in targets.
      legacyTargets.clear()
      val root=catalogRootTag?.let {view(it)} ?: attachedWindow?.decorView
      val focusables=ArrayList<View>();root?.addFocusables(focusables,View.FOCUS_FORWARD,View.FOCUSABLES_ALL)
      for(v in focusables) if(!targets.containsKey(v.id) && v.id!=View.NO_ID && v.isEnabled && (v.isClickable || v is EditText)) {
        legacyTargets[v.id]=Entry(v.id,"native:${catalogRootTag ?: 0}:${v.id}","content","content",false)
      }
    }
    val current=targets[currentView.id] ?: legacyTargets[currentView.id] ?: return false
    if(current.scope!=activeScope){restore("scope-restore");return true}
    fun measured(entry: Entry): TvFocusPolicy.Target? {
      val v=view(entry.tag) ?: return null
      if(!v.isAttachedToWindow || !v.isShown || !v.isEnabled || !v.isFocusable || v.width<=0 || v.height<=0) return null
      val xy=IntArray(2);v.getLocationInWindow(xy)
      return TvFocusPolicy.Target(entry.tag,entry.id,entry.scope,entry.region,xy[0].toFloat(),xy[1].toFloat(),v.width.toFloat(),v.height.toFloat())
    }
    val currentRect=measured(current) ?: return true
    val candidates=entries().filter { it.scope==activeScope }.mapNotNull { measured(it) }
    val rememberedContent=lastContent?.takeIf { targets[it.tag]==it && it.scope==activeScope && measured(it)!=null }
    val returning=current.region=="navigation" && direction=="right" && TvFocusPolicy.verticalRail(candidates)
    val next=if(returning) TvFocusPolicy.railReturn(rememberedContent?.let { measured(it) },lastContentRegion,candidates,activeScope)
      else TvFocusPolicy.move(currentRect,direction,candidates,activeScope)
    moveOutcome="boundary"
    if(next!=null) (targets[next.tag] ?: legacyTargets[next.tag])?.let {
      expectedFocus=safeId(it.tag,it.id)
      expectedVisible=view(it.tag)?.getGlobalVisibleRect(Rect())==true
      moveOutcome=if(focus(it,"native-input") && actualFocus()?.id==it.tag) "moved" else "request-failed"
    }
    return true // A boundary retains the actual target; it never selects an arbitrary item.
  }
  private fun detach() {
    cancelRestore();stability.clear()
    layoutListener?.let {if(attachedWindow?.decorView?.viewTreeObserver?.isAlive==true) attachedWindow?.decorView?.viewTreeObserver?.removeOnGlobalLayoutListener(it)}
    layoutListener=null
    clearInspectedWindows()
    val window=attachedWindow
    if(window!=null && window.callback===wrapper) window.callback=original
    focusListener?.let { if(window?.decorView?.viewTreeObserver?.isAlive==true) window.decorView.viewTreeObserver.removeOnGlobalFocusChangeListener(it) }
    for((observer,listener) in modalObservers) if(observer.isAlive) observer.removeOnGlobalFocusChangeListener(listener)
    modalObservers.clear()
    outlined?.foreground=originalForeground
    outlined=null;originalForeground=null;focusListener=null;original=null;wrapper=null;attachedWindow=null;consumed.clear()
  }
  private val inspectedWindows=mutableMapOf<Window,Pair<Window.Callback,Window.Callback>>()
  private fun clearInspectedWindows() {
    for((window,pair) in inspectedWindows) if(window.callback===pair.second) window.callback=pair.first
    inspectedWindows.clear()
  }
  private fun inspectDialogs(root: View?) {
    if(root==null) return
    // RN 0.81.5 ReactModalHostView exposes public getDialog(). No unsupported TV API.
    if(root.javaClass.name=="com.facebook.react.views.modal.ReactModalHostView") {
      val dialog=try {root.javaClass.getMethod("getDialog").invoke(root) as? android.app.Dialog} catch(_:Exception){null}
      val window=dialog?.window
      if(window!=null && !inspectedWindows.containsKey(window)) {
        val previous=window.callback
        if(previous!=null) {
          val observer=object:Window.Callback by previous {
            override fun dispatchKeyEvent(event:KeyEvent):Boolean = dispatchOwned(event,window,previous)
          }
          inspectedWindows[window]=Pair(previous,observer);window.callback=observer
        }
      }
    }
    if(root is ViewGroup) for(i in 0 until root.childCount) inspectDialogs(root.getChildAt(i))
  }
  private fun observeKey(event:KeyEvent, dispatch:()->Boolean):Boolean {
    if(event.action==KeyEvent.ACTION_DOWN || event.action==KeyEvent.ACTION_UP)lastInputAt=now()
    if(event.action==KeyEvent.ACTION_DOWN){cancelRestore();expectedFocus="none";moveOutcome="not-directional"}
    val eventId=TvFocusStability.eventId(event.deviceId,event.downTime,event.keyCode,event.action,event.repeatCount)
    val press=TvFocusStability.eventId(event.deviceId,event.downTime,event.keyCode,0,0)
    delivery=if(stability.lateRepeat(press,event.action,event.repeatCount)) "late-repeat" else if(stability.seen(eventId)) "duplicate" else if(event.repeatCount>0) "repeat" else "fresh"
    val wasDispatching=dispatchingInput;dispatchingInput=true
    if(!inspectorEnabled)try {return dispatch()} finally {dispatchingInput=wasDispatching}
        val key=when(event.keyCode) {
          KeyEvent.KEYCODE_DPAD_UP->"UP";KeyEvent.KEYCODE_DPAD_DOWN->"DOWN";KeyEvent.KEYCODE_DPAD_LEFT->"LEFT";KeyEvent.KEYCODE_DPAD_RIGHT->"RIGHT"
          KeyEvent.KEYCODE_DPAD_CENTER,KeyEvent.KEYCODE_ENTER->"OK";KeyEvent.KEYCODE_BACK->"BACK";KeyEvent.KEYCODE_MENU->"MENU"
          KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE->"PLAY_PAUSE";KeyEvent.KEYCODE_MEDIA_PLAY->"PLAY";KeyEvent.KEYCODE_MEDIA_PAUSE->"PAUSE";KeyEvent.KEYCODE_MEDIA_STOP->"STOP"
          KeyEvent.KEYCODE_MEDIA_NEXT->"NEXT";KeyEvent.KEYCODE_MEDIA_PREVIOUS->"PREVIOUS"
          in KeyEvent.KEYCODE_BUTTON_A..KeyEvent.KEYCODE_BUTTON_MODE->"GAMEPAD";else->"OTHER"
        }
        val phase=if(event.action==KeyEvent.ACTION_DOWN) if(event.repeatCount>0) "REPEAT" else "DOWN" else if(event.action==KeyEvent.ACTION_UP) "UP" else "OTHER"
        if(event.action==KeyEvent.ACTION_DOWN) inspectorSequence++
        diagnostic("input",key,phase)
        try {
          val started=System.nanoTime()
          val handled=dispatch()
          dispatchDurationMs=(System.nanoTime()-started)/1_000_000.0
          diagnostic("dispatch",key,phase,handled)
          return handled
        } finally {dispatchingInput=wasDispatching}
  }
  private fun dispatchOwned(event: KeyEvent, window: Window, previous: Window.Callback): Boolean = observeKey(event) {
    val id=TvFocusStability.eventId(event.deviceId,event.downTime,event.keyCode,event.action,event.repeatCount)
    val press=TvFocusStability.eventId(event.deviceId,event.downTime,event.keyCode,0,0)
    if(event.action==KeyEvent.ACTION_UP)stability.release(press)
    if(stability.lateRepeat(press,event.action,event.repeatCount)) true
    else if(stability.seen(id)) stability.result(id) ?: true
    else {
      stability.begin(id)
      val result=dispatchObserved(event,window,previous);stability.finish(id,result);result
    }
  }
  private fun dispatchObserved(event: KeyEvent, window: Window, previous: Window.Callback): Boolean {
        dispatchOwner="window-delegate"
        if(event.action==KeyEvent.ACTION_UP && consumed.remove(event.keyCode)) return true
        if(event.action==KeyEvent.ACTION_DOWN && event.keyCode==KeyEvent.KEYCODE_BACK && event.repeatCount>0 && consumed.contains(event.keyCode)) return true
        val direction=when(event.keyCode) {KeyEvent.KEYCODE_DPAD_LEFT->"left";KeyEvent.KEYCODE_DPAD_RIGHT->"right";KeyEvent.KEYCODE_DPAD_UP->"up";KeyEvent.KEYCODE_DPAD_DOWN->"down";else->null}
        val select=event.keyCode==KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode==KeyEvent.KEYCODE_ENTER
        if(event.action==KeyEvent.ACTION_DOWN && event.keyCode==KeyEvent.KEYCODE_BACK && activeScope=="content" && !playerActive && actualFocus()?.let {targets[it.id]?.region}=="navigation") {
          dispatchOwner="native-focus";consumed.add(event.keyCode);move("right");return true
        }
        if(event.action==KeyEvent.ACTION_DOWN && !(playerActive && hidden)) {
          if(direction!=null && window.currentFocus is EditText && (direction=="left"||direction=="right")) return previous.dispatchKeyEvent(event)
          if(direction!=null && move(direction)) {dispatchOwner="native-focus";consumed.add(event.keyCode);return true}
          if(select) {
            val current=actualFocus()?.takeIf { it.rootView===window.decorView.rootView && it.hasFocus() }
           ?: window.currentFocus?.takeIf { it.hasFocus() }
            val entry=current?.let {targets[it.id] ?: legacyTargets[it.id]}
            if(entry!=null) {
              dispatchOwner="native-selection"
              if(entry.scope==activeScope && current is EditText) return previous.dispatchKeyEvent(event)
              consumed.add(event.keyCode)
              if(entry.scope==activeScope && event.repeatCount==0) current?.performClick()
              else if(entry.scope!=activeScope) restore()
              return true
            }
            if(playerActive) {consumed.add(event.keyCode);restore();return true}
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
        dispatchOwner="player-semantic"
        if(event.action==KeyEvent.ACTION_DOWN) {
          consumed.add(event.keyCode)
          if(event.repeatCount==0 || direction!=null) sendEvent("onRemoteKey",mapOf("key" to name,"code" to event.keyCode))
        }
        return true
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
    val layout=ViewTreeObserver.OnGlobalLayoutListener {structural("layout")}
    layoutListener=layout;window.decorView.viewTreeObserver.addOnGlobalLayoutListener(layout)
    val callback=object: Window.Callback by previous {
      override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        return dispatchOwned(event,window,previous)
      }

    }
    wrapper=callback;window.callback=callback
    outline(window.currentFocus)
    return true
  }
  override fun definition()=ModuleDefinition {
    Name("LegendStreamTvRemote")
    Events("onRemoteKey","onNativeFocus","onInspector")
    AsyncFunction("setInspector") { enabled: Boolean ->
      inspectorEnabled=enabled;inspectorSequence=0;inspectorSalt=java.util.UUID.randomUUID().toString()
      if(enabled) {attach();observedFocusId=anonymousFocus(actualFocus());focusBefore=observedFocusId;focusCause="snapshot";withoutInput=false;inspectDialogs(attachedWindow?.decorView);diagnostic("snapshot")}
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("registerTarget") { tag: Int,id: String,scope: String,region: String,preferred: Boolean ->
      if(!attach()) return@AsyncFunction false
      val previous=targets[tag]
      targets[tag]=Entry(tag,id,scope,region,preferred)
      if(previous==null)structural("target-registration")
      view(tag)?.let {watchModal(it)}
      if(actualFocus()?.id==tag){remembered[scope]=id;observedFocusId=anonymousFocus(view(tag));sendEvent("onNativeFocus",mapOf("tag" to tag,"id" to id))}
      val current=actualFocus()?.let {targets[it.id]}
      if(scope==activeScope && (current==null || current.scope!=activeScope) && (remembered[scope]==id || preferred)) restore("mount-restore")
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("unregisterTarget") { tag: Int ->
      val removed=targets.remove(tag)
      if(removed==lastContent)lastContent=null
      if(removed!=null){structural("virtualization");cancelRestore()}
      true }.runOnQueue(Queues.MAIN)
    AsyncFunction("requestTargetFocus") { tag: Int -> targets[tag]?.let {cancelRestore();focus(it,"explicit-restore")} ?: false }.runOnQueue(Queues.MAIN)
    // Called by RN Modal.onShow, after the Dialog window is attached. Registration
    // may precede attachment; onShow is the lifecycle gate, never a timer retry.
    AsyncFunction("modalShown") { scope: String ->
      if(!attach() || activeScope!=scope) return@AsyncFunction false
      for(window in inspectedWindows.keys.toList()) if(!window.decorView.isAttachedToWindow) {
        inspectedWindows.remove(window)?.let {pair -> if(window.callback===pair.second)window.callback=pair.first}
      }
      for(observer in modalObservers.keys.toList()) if(!observer.isAlive)modalObservers.remove(observer)
      inspectDialogs(attachedWindow?.decorView)
      entries().filter {it.scope==scope}.forEach {entry -> view(entry.tag)?.let {watchModal(it)}}
      restore("modal-shown")
      diagnostic("modal-ready")
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setScope") { scope: String ->
      if(!attach()) return@AsyncFunction false
      if(activeScope!=scope) {cancelRestore();structural(if(scope=="content"||scope=="player")"scope-transition" else "modal-transition");activeScope=scope;if(scope.startsWith("player-panel:"))remembered.remove(scope);restore("scope-restore")}
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setFocusBlocked") { tag: Int,blocked: Boolean ->
      val group=view(tag) as? ViewGroup ?: return@AsyncFunction false
      if(catalogRootTag!=tag) {catalogRootTag=tag;lastContent=null;lastContentRegion=null;remembered.remove("content");legacyTargets.clear()}
      group.descendantFocusability=if(blocked) ViewGroup.FOCUS_BLOCK_DESCENDANTS else ViewGroup.FOCUS_AFTER_DESCENDANTS
      if(blocked) {cancelRestore();group.clearFocus()} else restore("scope-unblock")
      true
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("configure") { active: Boolean,controlsHidden: Boolean ->
      playerActive=active;hidden=controlsHidden
      attach()
    }.runOnQueue(Queues.MAIN)
    OnDestroy { appContext.currentActivity?.runOnUiThread {detach();targets.clear();legacyTargets.clear();remembered.clear()} }
  }
}
