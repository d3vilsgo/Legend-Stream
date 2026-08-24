const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
} = require("expo/config-plugins");

const ensureUsesFeature = (manifest, name) => {
  manifest["uses-feature"] = manifest["uses-feature"] || [];
  const exists = manifest["uses-feature"].some(
    (entry) => entry?.$?.["android:name"] === name,
  );
  if (!exists) {
    manifest["uses-feature"].push({
      $: {
        "android:name": name,
        "android:required": "false",
      },
    });
  }
};

const TV_FOCUS_MARKER = "// @legendstream-tv-focus";

function injectTvRuntime(source) {
  if (source.includes(TV_FOCUS_MARKER)) return source;
  const imports = `
import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.view.KeyEvent
import android.view.View
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.WeakHashMap
`;
  const packageLine = source.match(/^package\s+[^\n]+\n/m);
  if (!packageLine) throw new Error("Could not locate MainActivity package declaration");
  let next = source.replace(packageLine[0], `${packageLine[0]}${imports}`);

  const onCreateCall = "super.onCreate(null)";
  if (!next.includes(onCreateCall)) {
    throw new Error("Could not locate MainActivity super.onCreate(null)");
  }
  next = next.replace(
    onCreateCall,
    `${onCreateCall}\n    installLegendStreamTvFocusRing()`,
  );

  const classClose = next.lastIndexOf("}");
  if (classClose < 0) throw new Error("Could not locate MainActivity class closing brace");
  const helper = `

  ${TV_FOCUS_MARKER}
  private fun isLegendStreamTv(): Boolean {
    val manager = getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
    return manager?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
  }

  private fun legendStreamTvEventType(keyCode: Int): String? = when (keyCode) {
    KeyEvent.KEYCODE_DPAD_UP -> "up"
    KeyEvent.KEYCODE_DPAD_DOWN -> "down"
    KeyEvent.KEYCODE_DPAD_LEFT -> "left"
    KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
    KeyEvent.KEYCODE_DPAD_CENTER,
    KeyEvent.KEYCODE_ENTER,
    KeyEvent.KEYCODE_NUMPAD_ENTER,
    KeyEvent.KEYCODE_BUTTON_A -> "select"
    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "playPause"
    KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
    KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
    else -> null
  }

  private fun emitLegendStreamTvKey(eventType: String, event: KeyEvent) {
    val reactApplication = application as? ReactApplication ?: return
    val reactContext = reactApplication.reactNativeHost.reactInstanceManager.currentReactContext ?: return
    val payload = Arguments.createMap().apply {
      putString("eventType", eventType)
      putInt("eventKeyAction", event.action)
      putInt("repeatCount", event.repeatCount)
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("LegendStreamTVRemote", payload)
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (isLegendStreamTv()) {
      val eventType = legendStreamTvEventType(event.keyCode)
      if (eventType != null) {
        emitLegendStreamTvKey(eventType, event)
        if (
          event.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
          event.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
          event.keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE
        ) {
          return true
        }
      }
    }
    return super.dispatchKeyEvent(event)
  }

  private fun installLegendStreamTvFocusRing() {
    if (!isLegendStreamTv()) return

    val previousForeground = WeakHashMap<View, Drawable?>()
    val previousElevation = WeakHashMap<View, Float>()
    val density = resources.displayMetrics.density
    val strokeWidth = (3f * density).toInt().coerceAtLeast(2)
    val cornerRadius = 14f * density

    window.decorView.viewTreeObserver.addOnGlobalFocusChangeListener { oldFocus, newFocus ->
      oldFocus?.let { old ->
        if (previousForeground.containsKey(old)) old.foreground = previousForeground.remove(old)
        previousElevation.remove(old)?.let { old.elevation = it }
      }
      newFocus?.let { focused ->
        previousForeground[focused] = focused.foreground
        previousElevation[focused] = focused.elevation
        focused.foreground = GradientDrawable().apply {
          setColor(Color.TRANSPARENT)
          setStroke(strokeWidth, Color.rgb(34, 211, 238))
          this.cornerRadius = cornerRadius
        }
        focused.elevation = maxOf(focused.elevation, 14f * density)
      }
    }

    window.decorView.postDelayed({
      if (window.currentFocus == null) {
        window.decorView.focusSearch(View.FOCUS_FORWARD)?.requestFocus()
      }
    }, 650L)
  }
`;
  return `${next.slice(0, classClose)}${helper}${next.slice(classClose)}`;
}

module.exports = function withAndroidTV(config) {
  config = withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    ensureUsesFeature(manifest, "android.software.leanback");
    ensureUsesFeature(manifest, "android.hardware.touchscreen");

    const application = manifest.application?.[0];
    if (!application) throw new Error("Android application manifest entry was not generated.");
    application.$ = application.$ || {};
    application.$["android:banner"] = "@drawable/tv_banner";

    const activities = application.activity || [];
    const mainActivity = activities.find((activity) =>
      String(activity?.$?.["android:name"] || "").endsWith("MainActivity"),
    );
    if (!mainActivity) throw new Error("MainActivity was not found in AndroidManifest.xml");

    mainActivity["intent-filter"] = mainActivity["intent-filter"] || [];
    let launcher = mainActivity["intent-filter"].find((filter) =>
      (filter?.action || []).some(
        (action) => action?.$?.["android:name"] === "android.intent.action.MAIN",
      ),
    );
    if (!launcher) {
      launcher = {
        action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
        category: [],
      };
      mainActivity["intent-filter"].push(launcher);
    }
    launcher.category = launcher.category || [];
    const categories = new Set(
      launcher.category.map((category) => category?.$?.["android:name"]).filter(Boolean),
    );
    if (!categories.has("android.intent.category.LAUNCHER")) {
      launcher.category.push({ $: { "android:name": "android.intent.category.LAUNCHER" } });
    }
    if (!categories.has("android.intent.category.LEANBACK_LAUNCHER")) {
      launcher.category.push({ $: { "android:name": "android.intent.category.LEANBACK_LAUNCHER" } });
    }

    return configWithManifest;
  });

  config = withMainActivity(config, (configWithActivity) => {
    if (configWithActivity.modResults.language !== "kt") {
      throw new Error("LegendStream Android TV plugin expects Kotlin MainActivity");
    }
    configWithActivity.modResults.contents = injectTvRuntime(
      configWithActivity.modResults.contents,
    );
    return configWithActivity;
  });

  config = withDangerousMod(config, [
    "android",
    async (configWithProject) => {
      const source = path.join(
        configWithProject.modRequest.projectRoot,
        "assets",
        "images",
        "tv-banner.png",
      );
      const drawable = path.join(
        configWithProject.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "drawable",
      );
      const target = path.join(drawable, "tv_banner.png");
      if (!fs.existsSync(source)) throw new Error(`Android TV banner missing: ${source}`);
      fs.mkdirSync(drawable, { recursive: true });
      fs.copyFileSync(source, target);
      return configWithProject;
    },
  ]);

  return config;
};
