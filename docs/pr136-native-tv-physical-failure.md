# PR #136 — APK #491 fiziksel FAIL kök nedenleri ve düzeltme adayı

Kaynak gate: PR #136 OPEN / DRAFT / NOT MERGED, HEAD `338e73db16a768a3954ca7ae0de9d6d27cddaa67`; yerel başlangıç aynı ve temiz. Aynı branch üzerinde çalışılır: `feature/r18-native-tv-remote-player-parity`. Branch sıfırlanmaz; yeni PR/merge yoktur.

Homatics 4K V2 / Universal APK #491: **NATIVE_TV_PHYSICAL_FAIL**. Kullanıcı gözlemleri kabul kanıtıdır. Sağlanan 109,7 saniyelik videonun örnek karelerinde Home/navigasyon, oynatıcı hazırlanıyor ekranı, TV launcher ve canlı yayın ekranı görülür. Karelerden hangi fiziksel tuşun basıldığı veya hangi Back listener'ının tükettiği kesin çıkarılamaz; bu bölümde böyle bir runtime izi varmış gibi hüküm verilmez.

## F-01 — Gerçek Android odağı ile JS vurgu olayının kopması — P0

**Dosya:** `app.json`; React Native 0.81.5 `ReactAndroid/src/main/java/com/facebook/react/uimanager/BaseViewManager.java`, `UIManagerHelper.kt`; `FocusButton.tsx`, `TVPreviewFocus.tsx`, `PlayerRemotePressable.tsx`.

**Gerçek kanıt:** Uygulamada `newArchEnabled=false`. BaseViewManager'ın BaseVMFocusChangeListener'ı `surfaceId == View.NO_ID` olduğunda FocusEvent/BlurEvent göndermeden döner. UIManagerHelper eski mimaride surface ID kullanılmadığını ve değerin `-1` olduğunu açıkça belirtir. Önceki üç ortak wrapper vurgu state'ini RN `onFocus/onBlur` üzerinden güncelliyordu. Focus prop'unun kaynakta bulunması, bu APK mimarisinde event'in JS'e ulaştığını kanıtlamıyordu.

**Kullanıcı etkisi:** D-pad odağı ve OK çalışabildiği halde poster/menü/player kontrolünde görünür vurgu oluşmayabilir; kullanıcı tahmin ederek seçim yapar.

**Yeniden üretim:** APK #491 / Homatics üzerinde D-pad ile Home öğeleri ve player kontrolleri arasında hareket et; Android'in seçimi değişirken JS tabanlı vurgu gözlenmez. Paper sürümünün `-1` erken dönüşü kaynak üzerinden yeniden üretilebilir.

**Kök neden:** Fiziksel odağın kaynağı Android iken görsel geri bildirim, bu mimaride iletilmeyebilen ayrı bir JS event hattına bağlanmıştı.

**En küçük düzeltme:** Mevcut native modüle ViewTreeObserver.OnGlobalFocusChangeListener eklenir. Gerçek odaktaki View'a, sınırların içinde kalan siyah/beyaz foreground çerçevesi çizilir; önceki foreground blur/cleanup sırasında geri konur. Native tag/kararlı ID olayı `useNativeTvTarget` hook'una taşınır. Ortak katalog wrapper'ı, FocusButton ve player/panel wrapper'ı aynı hattı kullanır. React Native sürümü/mimarisi değiştirilmez.

**Regresyon testi:** JVM testleri üretim yön politikasını çalıştırır; TypeScript ve mevcut mobil/TV Preview kontratları korunur. Gerçek ViewTreeObserver, çizim, Paper click köprüsü ve cihaz çerçevesi JVM'de simüle edilemez; Homatics turu zorunludur.

## F-02 — İçerik ↔ üst navigasyon arasında açık bağlantı yokluğu — P0

**Dosya:** `ResponsiveContentNav.tsx`, `FocusButton.tsx`, `TVPreviewFocus.tsx`; yeni üretim `TvFocusPolicy.java` ve native modül.

**Gerçek kanıt:** Üst navigasyon ayrı horizontal ScrollView; Home ve kataloglar ayrı scroll/sanallaştırılmış yüzeylerdir. Önceki native davranış bu bölgeler arasında Android FocusFinder'a bırakılmıştı; üst sınırdan navigasyona giden açık bir kural veya kararlı navigasyon hedef kaydı yoktu.

**Kullanıcı etkisi:** Home'dan içerik açılır, fakat Canlı TV/Filmler/Diziler/Ayarlar bölümlerine güvenilir erişim sağlanamaz.

**Yeniden üretim:** Home içeriğine odaklan; Yukarı ile üst navigasyona çık, Live/Filmler/Diziler/Ayarlar seç, Aşağı ile yeni içeriğe in. #491 fiziksel gözlemi başarısızdır.

**Kök neden:** İçerik ve navigasyon, ortak gerçek odak kimliği/region grafiğinde temsil edilmiyordu.

**En küçük düzeltme:** `nav:<key>` kararlı hedefleri native kaydedilir. Üretim Java politikası navigation/content/player bölgelerini ayırır. İçeriğin üst sınırında Yukarı açıkça navigasyona gider; navigasyonda Sol/Sağ yalnız menüde ilerler; Aşağı mevcut ekranın ölçülmüş içeriğine iner. Hedef yoksa mevcut odak korunur. OK, gerçek odaktaki kayıtlı View'ın `performClick()` çağrısıdır; mevcut React `onPress` ve ekran state callback'i kullanılır, ikinci route modeli oluşturulmaz.

**Regresyon testi:** JVM'de Home → navigasyon → Live, Live → Filmler → Diziler → Ayarlar, içerik ve dört yön; callback/aktif ekran durum simülasyonları. Bunlar gerçek React render/onPress entegrasyon testi değildir; gerçek `performClick → RN onPress → active view` zinciri cihazda ayrıca doğrulanır.

## F-03 — Player Back'in native katmanda tek sahibinin olmaması — P0

**Dosya:** `LegendStreamTvRemoteModule.kt`, `CompatibilityVideoPlayerV2.tsx`, `PlayerChrome.tsx`, `playerRemoteOwnership.ts`; katalog BackHandler'ları.

**Gerçek kanıt:** #491 native callback Back'i yakalamadan `previous.dispatchKeyEvent` yoluna bırakıyordu. Native köprünün aktifliği Chrome mount/unmount'una bağlıydı. Katalog korumaları JS listener'ları düzeyindeydi. Video/kullanıcı gözlemi güvenilir katalog dönüşü olmadığını gösterir; hangi listener'ın hangi fiziksel Back'i tükettiğini gösteren eski native runtime izi yoktur.

**Kullanıcı etkisi:** Hazırlık/gizli kontrol/çıkış aralığında güvenli player dönüşü garanti edilemez; launcher'a düşüş kabulü engeller.

**Yeniden üretim:** Player hazırlanırken, panel açıkken, kontroller açıkken ve gizliyken ayrı ayrı Back bas. Üç hızlı Back basışını da dene.

**Kök neden:** Tek sahiplik JS katmanında tasarlanmış, native Back yolu aynı sahipliğe bağlanmamıştı. React render beklenirken art arda basışların aynı closure state'ini görme riski de vardı.

**En küçük düzeltme:** Player köprüsü root player ömründe aktiftir. Native Back down/up bir kez tüketilip yalnız root player handler'ına iletilir. Chrome Back'i ayrıca işlemez. Aynı mevcut panel → kontroller → çıkış callback'i kullanılır. `advancePlayerBack` snapshot'ı senkron ilerletir; katalog Set koruması ve telefonun mevcut Back davranışı korunur.

**Regresyon testi:** Native TV Back öncelik/sahiplik testleri; React commit beklemeden üç basışın panel/controls/exit ilerlemesi; telefon direct exit davranışı. OS Back dispatch ve Homatics tuş tekrarı fiziksel test gerektirir.

## F-04 — Progress yazımının çıkışı süresiz bekletebilmesi — P0

**Dosya:** `CompatibilityVideoPlayerV2.tsx`, `playerExitPersistence.ts`.

**Gerçek kanıt:** Eski exitPlayer, callback ve orientation restore öncesinde `await persistProgress()` yapıyordu. Hata catch'i vardı; hiç sonuçlanmayan Promise için üst süre sınırı yoktu. Bunun fiziksel videodaki tek neden olduğu iddia edilmez; kaynakta mevcut bir güvenilirlik açığıdır.

**Kullanıcı etkisi:** Yavaş/takılan storage, Back ile çıkışı player gate ekranında bekletebilir.

**Yeniden üretim:** Save dependency'sini sonuçlanmayan Promise ile çalıştır.

**Kök neden:** Çıkışın UI ilerlemesi ile storage tamamlanması sınırsız biçimde bağlıydı.

**En küçük düzeltme:** Yalnız Native TV'de save en fazla 1500 ms beklenir. Telefonun mevcut awaited save davranışı ve mevcut hata catch'i korunur; veri/protokol/yazma mimarisi değiştirilmez.

**Regresyon testi:** Pending save, başarılı tek save, hata ve telefonun beklemeyi sürdürmesi; yeni nativeTvExitScenarios davranış testleri.

## F-05 — Sabit TV ekranında mobil sensor hazırlığı — P0 erişilebilirlik riski

**Dosya:** `hooks/usePlayerOrientation.ts`.

**Gerçek kanıt:** #491 prepare, native TV dahil getOrientation/getOrientationLock/unlock sorgularını ready öncesi bekliyordu. Videoda hazırlanıyor ekranı vardır; videodan hangi OEM çağrısının geciktiği kesinleştirilemez.

**Kullanıcı etkisi:** TV'de anlamlı olmayan sensor/rotation hazırlığı, kontrolleri geciktirebilir.

**Yeniden üretim:** Native TV prepare yolunu izleyip ScreenOrientation Promise tamamlanmasını geciktir.

**Kök neden:** Catalog native preserve politikasına rağmen player giriş hazırlığı mobil sensor yolundan ayrılmamıştı.

**En küçük düzeltme:** Ownership alındıktan sonra TV'de mobil sensor hazırlığı atlanır; finally ready ve normal ownership handoff korunur. Telefon/tablet yolu değiştirilmez.

**Regresyon testi:** Mevcut 14 orientation lifecycle senaryosu ve TypeScript. OEM ScreenOrientation/gerçek hazırlık süresi fiziksel turdadır.

## F-06 — Tag/kararlı ID, scope, modal ve restore boşlukları — P0

**Dosya:** Ortak FocusButton/TVPreviewPressable/PlayerRemotePressable, NativeTVFocusScope ve native modül.

**Gerçek kanıt:** Navigasyon FocusButton'ları ortak katalog registry'sinde değildi. Player kontrolleri kararlı semantik ID vermiyordu. Eski restore `setNativeProps(hasTVPreferredFocus)` kullanıyordu. Activity.findViewById modal dialog altındaki React hedeflerini çözmez.

**Kullanıcı etkisi:** Fiziksel hedef, çizilen vurgu ve restore farklı öğeleri gösterebilir; modal hedefi bulunamaz veya çıkışta odak kaybolabilir.

**Yeniden üretim:** Kategori modalını aç/kapat; uzak bir satırdan player'a gir/çık; VOD/Series posterleri ve panel track satırlarında ilerle; paging sınırını geç.

**Kök neden:** Kayıt/odak/restore aynı native View kimliğine bağlı değildi; modal ayrı pencere olmasına rağmen yalnız Activity ağacı varsayılmıştı.

**En küçük düzeltme:** Kayıt gerçek React native tag + kararlı ID + scope/region içerir. requestTargetFocus gerçek View.requestFocus/requestRectangleOnScreen kullanır. Android her scope'un son ID'sini saklar. Modal hedefi UIManager.resolveView ile çözülür ve kendi ViewTreeObserver'ı izlenir; modal Back mevcut onRequestClose'a bırakılır. Sanallaştırılmış öğe unmount olunca kayıt silinir. JS provider scope'u Android scope'a aktarır; kayıtlı hedef yokken rastgele OK uygulanmaz. Series detay Back başlangıç hedefi açıkça tanımlanır. Native foreground çerçevesi hücrenin içinde kalır ve poster clipping'ine dayanır.

**Regresyon testi:** Üretim JVM politikasında kayıt dışı/recycled hedef, yeni sayfa, yeni ölçüm, scope izolasyonu ve sınırlarda kalma; TV Preview 32 senaryo. Gerçek Recycler/ViewTreeObserver/Modal window ve scrolling JVM'de çalıştırılmaz.

## Kabul ve test sınırı

CI/TypeScript/JVM PASS, **Native Android TV fiziksel PASS değildir**. Yeni aday için beş şart da Homatics üzerinde doğrulanmalıdır:

1. Home/katalog/player'da gerçek odak beyaz/siyah çerçeveyle görülür.
2. Home içeriği → Yukarı → üst navigasyon; Live/Filmler/Diziler/Ayarlar arasında Sol/Sağ + OK; Aşağı ile seçilen ekranın içeriği.
3. Xtream Live kanal satırları, VOD posterleri, Series poster → detay → bölüm → player. Paging/scroll ve kategori modalı dahil.
4. Player OK → görünür kontrol → list/audio/CC/fit/codec seçimi; boş/disabled açıklamaları; mevcut playback action'larının uygulanması.
5. Back: panel → kontroller → katalog; hızlı üç basış dahil; launcher'a düşmeden önceki katalog odağı. Hazırlık sırasında Back de denenir.

M3U ve Stalker Live/VOD/Series ayrı ayrı; telefon dokunma/seek/rotation/Back ve TV Preview sanal D-pad ayrı regresyon turlarıdır. Stalker probe EPG ürün özelliği sayılmaz. Mevcut provider protokolü, URL çözümü, storage writer, credentials/security ve `android-apk.yml` değiştirilmez.

**Son fiziksel karar: #491 FAIL devam eder. Yeni APK fiziksel test edilene kadar adaydır. Hiçbir PR merge edilmez.**
