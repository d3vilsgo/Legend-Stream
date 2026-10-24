# U4.3 Native TV Focus referans onarımı

Başlangıç: `48565355c809932f75a6d83411f460848650ee6d`; PR #143 OPEN/DRAFT, base `feature/r19-tmdb-secure-proxy`. Başlangıç Quality #1491 SUCCESS (39259537098). Bu kayıt SOURCE/HOST kanıtıdır; Homatics fiziksel kapanışı değildir.

## Sabit kaynak kapısı

| Referans | İncelenen güncel SHA | Lisans / uyumluluk |
|---|---|---|
| TVInputDemo | `2cbd77e7999441b7bbcdbf8f46669b0fbaa244ec` | MIT; Expo 55, React 19.2, react-native-tvos 0.83-stable |
| react-native-tvos | `c142f8c5e55f1e7bc145f6428f230996018b6d2c` | MIT; geliştirme dalı, LegendStream RN 0.81.5 için doğrudan ikame değil |
| OwnTV | `cead977803d90bd62ece69b4140e373f01feddca` | GPLv3; yalnız davranış karşılaştırması, kod aktarılmadı |

LegendStream Expo 54 / standart React Native 0.81.5 kullanır. Yeni framework veya TVFocusGuideView bağımlılığı eklenmedi. Native Window/LegendStreamTvRemoteModule tek fiziksel odak sahibi olarak kalır.

## Kısa satır kanıtları ve semantik karşılık

- [TVInputDemo NextFocusExample.tsx L17–35](https://github.com/react-native-tvos/TVInputDemo/blob/2cbd77e7999441b7bbcdbf8f46669b0fbaa244ec/src/screens/NextFocusExample.tsx#L17-L35): L30 `nextFocusLeft={rightState}`; L33 `setLeftState(left.current)`. Ref hazır olunca yön hedefleri verilir. LegendStream karşılığı mevcut `useNativeTvTarget` register/identity kontrolüdür; örneğin ref/state uygulaması taşınmadı.
- [TVInputDemo TVFocusGuideViewExample.tsx L71–96](https://github.com/react-native-tvos/TVInputDemo/blob/2cbd77e7999441b7bbcdbf8f46669b0fbaa244ec/src/screens/TVFocusGuideViewExample.tsx#L71-L96): destinations yalnız bağlı referanslarla oluşturulur. [Navigation.tsx L37–39](https://github.com/react-native-tvos/TVInputDemo/blob/2cbd77e7999441b7bbcdbf8f46669b0fbaa244ec/src/navigation/Navigation.tsx#L37-L39) remote event'i gösterir; ikinci bir yön eylemi yürütmez.
- [RNTV TVFocusGuideView.js L60–72](https://github.com/react-native-tvos/react-native-tvos/blob/c142f8c5e55f1e7bc145f6428f230996018b6d2c/packages/react-native/Libraries/Components/TV/TVFocusGuideView.js#L60-L72): `onFocusEnter`, `onFocusLeave` bölge sınırı olaylarıdır. [useFocusEnterLeave.js L52–82](https://github.com/react-native-tvos/react-native-tvos/blob/c142f8c5e55f1e7bc145f6428f230996018b6d2c/packages/react-native/Libraries/Components/TV/useFocusEnterLeave.js#L52-L82): L56 `if (!state.entered)`; iç hedefler arası hareketi tekrar giriş saymaz. Oradaki deferred blur timeout'u taşınmadı; LegendStream tek native destination bildirimini kullanır.
- [OwnTV StageRail.kt L196–203](https://github.com/ahXN00/OwnTV/blob/cead977803d90bd62ece69b4140e373f01feddca/app/src/main/java/tv/own/owntv/features/shell/components/StageRail.kt#L196-L203): L199 `val entered = it.hasFocus && !hasFocus`. Alt öğeler arası hareket ile bölgeye giriş ayrılır. L204–232 RIGHT içerik dönüşünü ele alır; Compose coroutine/FocusRequester taşınmadı.
- [OwnTV OwnTVShell.kt L674–683](https://github.com/ahXN00/OwnTV/blob/cead977803d90bd62ece69b4140e373f01feddca/app/src/main/java/tv/own/owntv/features/shell/OwnTVShell.kt#L674-L683): shell rail state'i hesaplar; [L1401](https://github.com/ahXN00/OwnTV/blob/cead977803d90bd62ece69b4140e373f01feddca/app/src/main/java/tv/own/owntv/features/shell/OwnTVShell.kt#L1401) sidebar focus katmanını günceller. StageRail L182 gerçekten genişlik değiştirir; sabit geometri OwnTV'den alınmış bir iddia değildir, LegendStream'e özgü bağımsız onarımdır.

## Kanıtlanmış kaynak kusurları ve sınır

1. Önceki rail her öğenin `onFocusChange` effect'inden aynı native destination'ı alıyordu. Hook nav öğelerinde destination state'ini tutuyor, effect inline callback değişimini de bağımlılık sayıyordu. N bağlı menü öğesi bir destination için N rapor üretebilir; parent render tekrar effect üretebilirdi. Homatics'teki sonsuz layout/FocusFinder döngüsü cihaz izi olmadan kanıtlanmış değildir.
2. Java yön puanlamasında rail adayı farklı ağırlık kullanıyordu. Aynı geometride baseline LEFT ikinci raf kartından `nav:series` döndürdü; yeni üretim policy ilk raf kartını döndürür. Navigation artık geçerli içerik komşuları tükendiğinde fallback'tir.
3. Native Window zaten rail BACK'i içerik dönüşü olarak tüketirken React rail ayrıca BackHandler ile Home seçebiliyordu. Bu ikinci yol kaldırıldı. Modal/Player BACK sahibi değiştirilmedi.

## Üretim değişiklikleri

- `components/navigation/ResponsiveContentNav.tsx`: bir native bölge aboneliği; aynı bölge/boş geçici hedef no-op; unmount sonrası queued callback engeli. Menü öğelerinden setOpen callback'i yok. Sabit root/ikon hedef boyutları; açılan etiket ve arka plan odaklanmayan overlay. Seçili route yalnız OK/onPress ile değişir.
- `components/FocusButton.tsx`: callback ref'i ile yalnız gerçek focus boolean değişiminde bildirim; inline parent callback yeni bildirim üretmez.
- `hooks/useNativeTvTarget.ts`: destination fan-out state'i kaldırıldı; mevcut register/unregister ve native focused boolean korunur.
- `modules/legendstream-tv-remote/android/src/main/java/expo/modules/legendstreamtvremote/TvFocusPolicy.java`: LEFT içerik komşusu önceliği.
- `lib/tvRemoteInspector.ts`: mevcut kapalı/20 kayıtla sınırlı inspector'a yalnız navigation/content sabit değerli rail-state olayı. Provider, başlık, URL veya credential kaydetmez.

Native Kotlin, Player motoru, resolver, cache, mobil yoğunluk dosyaları değiştirilmedi. Mevcut lastContent geçerli target/activeScope/measurement kontrolü, provider root değişiminde temizleme ve session/revision restorasyon korumaları korunur.

## Yerel otomatik kanıt

- Gerçek StageRail + Live host 6/6: dar/geniş TV, tek abonelik; bir girişte tam 1 state geçişi, nav içi/tekrar/boş olayda 0 ek geçiş; sekiz hızlı çift yön ardından modal ile tam 18 geçiş; unmount sonrası queued callback 0; sabit hedef genişliği; OK dört sekme; Preview/mobil ayrımı; üretim Java LEFT komşu testi.
- Gerçek FocusButton + hook 9/9: RN sentetik focus/blur ikinci owner olmaz, callback kimliği değişimi yeni bildirim üretmez, aynı target yeniden register edilmez, teardown abonelik temizler.
- P0 üretim render 18/18; Visible Home/Player recovery 18/18; katlanan Hero 12/12; Series 40/40.
- Native JVM 66/66, stability 21/21, Home reachability 93/93; responsive model/JVM 240/240 ayrı ayrı.
- P1 Golden/Series 10 profil, Stalker Movies 10 profil, Stalker Live 4 profil PASS. U2 94/94 + gerçek hook 10/10; TV Preview 32/32; native remote 27/27; inspector 41/41. Typecheck PASS.
- Eski helper/source beklentileri kaldırılan callback API'si yerine tek subscription, cleanup ve sabit geometri sözleşmeleriyle güncellendi. Test silme, skip veya davranış assertion gevşetme yok.

## Ölçüm ve açık kabul

Host Java policy örnek koşu (Android dispatch değildir): 720dp p50 797ns / p95 1885ns; 1920dp p50 1651ns / p95 3045ns. Baseline ile cihaz performansı kıyası yapılmadı. Mevcut native inspector KeyEvent zamanı, inputAgeMs, dispatchDurationMs, before/after focus ve owner alanlarını sunar; bu oturumda fiziksel kayıt alınmadı. Native kayıt/render sayısının cihaz ölçümü yok.

SOURCE/HOST PASS kapsamı yukarıdaki fixture senaryolarıdır. Tam native Window + React bridge + gerçek modal/Player uçtan uca matris PARTIAL / PHYSICAL_PENDING_RC. Homatics: LEFT sınırı, UP/DOWN, OK ekran, RIGHT/BACK son içerik, uzun basış, hızlı karşı yön, modal, provider/session yenileme ve Player hata/Back yeniden denenmeli. Mobil katalog değişmedi; Poco regresyon doğrulaması fiziksel bekler. Native TV tarihsel Physical FAIL, TMDB LIVE BLOCKED ve legacy 14 SKIP / 0 DELETED korunur. U4.4'e başlanmadı.
