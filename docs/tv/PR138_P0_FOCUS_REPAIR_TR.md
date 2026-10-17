# PR #138 — P0 Native TV odak düzeltmesi

## Kaynak ve kabul

Remote #138 HEAD `3755a39b48441fd0904d3a40a7a8c77576ee0281`, APK #504 fiziksel test SHA'sıyla aynıdır. Yeni çalışma bu commit'in doğrudan devamıdır. #139/#140/#141'e aktarım, rebase, reset, merge, retarget veya yeni PR yoktur. TMDB kodu bu hatta bulunmaz.

**Native TV Physical FAIL devam ediyor.** Homatics testi yapılmadan düzeltmenin cihazdaki sonucu ve Android FocusFinder/firmware etkileşimi kanıtlanamaz. Kodda doğrulanan kusurlar fiziksel DOWN başarısızlığının tüm olası nedenlerinin kanıtı değildir; yeni teşhis alanları bunun ayrıştırılması içindir.

## Dosya → Kanıt → Kök neden → Düzeltme → Test → Kalan risk

| Dosya (app köküne göre) | Kanıt / kök neden | Düzeltme | Test | Kalan risk |
|---|---|---|---|---|
| `modules/legendstream-tv-remote/android/src/main/java/expo/modules/legendstreamtvremote/TvFocusPolicy.java` | Eski `primary + cross*2.2 + cross²/primary` skoru RIGHT sınırında başka raftaki çapraz kartı seçebiliyor; DOWN, uzaktaki hizalı raftan yana karar verebiliyor. | Yatayda ölçülen aynı satır, dikeyde bitişik satır ve en yakın sütun. Aynı satırdaki farklı yükseklikli favori düğmesi DOWN hedefi olmaz. Nav UP sınır; LEFT/RIGHT nav içinde; DOWN içeriğe; içerik UP nav'a dönebilir. | Üretim Java policy 49/49: dört yön, menü/hero/raf, çapraz tuzak, kanal/favori, grid, modal/player scopes, geri dönüştürülmüş tag, 0.5/1/2 geometri ölçekleri. | Ölçülen native dikdörtgenlerden türetilmiş deterministik grafiktir; tüm katalog için önceden hesaplanmış statik grid değildir. Asenkron ölçüm/virtualization fiziksel test ister. |
| `.../LegendStreamTvRemoteModule.kt` | Modal callback keşfi `inspectorEnabled` ile sınırlandırılmış; dialog callback'i yalnız gözlem yaparken activity dispatcher'ı yön/OK'yi sahipleniyor. Dolayısıyla pencere bağlamına göre davranış farklı. | Activity/dialog aynı `dispatchOwned` kullanır; gözlem aç/kapat sahipliği değiştirmez. Tek event kaydı ve pending duplicate için yeniden dispatch yerine tüketim; gerçek modal odağı kullanılır. | Mevcut stability 21/21; inspector observer eşdeğerliği. | Kotlin Android pencereleri bu JVM testlerinde çalışmaz. Android derleme ve gerçek modal dispatch testi gereklidir. |
| `.../LegendStreamTvRemoteModule.kt` | Measured adaylarda `isFocusable` kontrolü yok; kayıt geçişinde artık focusable olmayan hedef aday kalabilir. Eksik fiziksel odak Android default seçimine düşebilir. | Native focusable/attached/shown/enabled filtresi; eksik odakta yalnız geçerli restore/preferred isteği, rastgele seçim yok. EditText yatay cursor davranışı korunur. | Java sınır/scope testleri; runtime diagnostic `request-failed`, `boundary`, `missing-focus`. | Offscreen ama mounted komşu otomatik dışlanmaz: erişim için `requestRectangleOnScreen` kullanılır. Gerçek ScrollView reveal/virtualization Android'de doğrulanmalı. |
| `components/home/HomeDiscovery.tsx` | Raf ID'si yalnız item ID'den oluşuyor; aynı içerik farklı raflarda aynı mantıksal kimliği taşıyabiliyor. Yerel focus stili scale ve border kalınlığını değiştiriyor. | Raf kimliği item kimliğine eklenir; native focus scale kaldırılır, border genişliği sabitlenir. | TypeScript; mevcut Home/TV Preview regresyonları; scoped native ID testleri. | Önceden kaldırılmış katalog öğesi zorla restore edilmez. Raf sırası/veri yenilemesi fiziksel olarak denenmeli. |
| `components/FocusButton.tsx` | Native focus spring 1.055 scale yapıyor; komşu hedefle örtüşebilir. | Native scale 1; beyaz native outline korunur. Active/selected state odağı temsil etmez. | Native nav aksiyon/scope ve responsive testleri. | Native foreground çizimi ve ekran kenarı görünürlüğü cihaz bağımlıdır. |
| `lib/tvRemoteInspector.ts`, `components/tvPreview/TVRemoteInspector.tsx`, native bridge `index.ts` | Varsayılan expanded panel 560 dp, çok satırlı; anonim ID'ler amaç anlaşılmasını zorlaştırıyor. Beklenen hedef ve gerçek hedef ayrı raporlanmıyor. | Varsayılan kompakt köşe paneli; üst/alt konum focus Y'ye göre değişir; izinli UI aile etiketleri + anonim kısa son ek. Beklenen ID, gerçek ID, owner, sonuç ve viewport durumu ayrı alanlar. Geçmiş ayarlardan isteğe bağlı. | 41/41 observer/privacy: beklenen/gerçek ayrımı, yanlış veri redaksiyonu, köşe seçimi, kompakt varsayılan. | Panel farklı 3 metre mesafe/fontScale koşullarında fiziksel okunabilirlik ister. İçerik adı/provider kimliği gösterilmez. |

## Korunan mimari ve denetlenen kaynaklar

`hooks/useNativeTvTarget.ts` identity/layout kayıt ayrımını ve native event highlight'ını korur; ikinci JS yöneticisi eklenmedi. `TVPreviewFocus.tsx` handheld Preview controller'ı native TV'de yön otoritesi olmaz. `ResponsiveContentNav.tsx` gerçek `onSelect`/onPress ve nav FocusButton'larını kullanır. `PagedCatalogViews.tsx` kanal/favori, VOD, Series, sezon/bölüm ve kategori drawer hedefleri mevcut native kayıt sistemindedir; provider callback'leri değiştirilmedi.

Player giriş/Back zinciri `components/CompatibilityVideoPlayerV2.tsx`, `lib/playerRemoteOwnership.ts`, `PlayerChrome.tsx`, `PlayerChromeV2.tsx`, `PlayerRemotePressable.tsx` üzerinden denetlendi. Katalog `OptimizedHomeScreenPaged.tsx`, `StalkerMainPage.tsx` ve navigasyon BackHandler'ları `hasPlayerBackOwner()` ile geri durur. Panel → kontroller → çıkış eylem sırası korunur. Remote observer yeni playback başlatmaz; OK gerçek focused view'ın `performClick` eylemini çalıştırır. Menü/focus hareketi playback callback'i çağırmaz.

Alanlar: Home/nav, Live, Movies, Series içerikleri catalog root/content scope'unda kendi görünür ağaçlarıyla; Player `player`; paneller `player-panel:*`; kategori `category-drawer`. Ekranlar arasında gizli eski root adayları filtrelenir; modal/player scope'u arka katalogdan ayrılır. Mevcut görünümdeki ölçülmüş satırlar grafiği oluşturur, yeni bağımsız focus sahibi yoktur.

## Teşhis sözleşmesi

Native input kaydı hareket başarısı değildir. Dispatch kaydı `expectedFocus`, `moveOutcome`, `expectedVisible`, `dispatchOwner`, gerçek focus ve scope taşır. `native-focus`, `native-selection`, `player-semantic`, `window-delegate` ayrı gösterilir. `boundary` geçerli sınır; `request-failed` hedef bulunduğu halde gerçekleşmeyen fiziksel focus isteğidir. `missing-focus` gerçek owner bulunamamasıdır. `expectedVisible=false` komşunun scroll reveal gerektirdiğini belirtir; `true` sadece `getGlobalVisibleRect` kanıtıdır, tam görünürlük garantisi değildir.

Önceki/sonraki gerçek focus ve son input'tan geçen süre, programatik restore veya layout/virtualization korelasyonu mevcut olaylarda korunur. Layout korelasyonu kesin sebep diye raporlanmaz. Inspector kapatmak pending restore üretmez ve artık native pencere sahipliğini değiştirmez. Native input gözlemi veri üretir; dispatcher mevcut sahiplik modelinin parçasıdır.

## Testler ve sınırları

Yerel: JVM focus49/49, stability21/21; Inspector41/41; native remote25/25; native exit6/6; TV Preview32/32; responsive240/240; mobile TypeScript; Universal APK build sözleşmesi. Tam mevcut provider/orientation/katalog regresyonları exact-SHA Quality'de çalışır. Quality bağlantısı ve yeni SHA PR sonuç bölümündedir.

0.5/1/2 Java geometri ölçekleri aynı policy davranışını sınar; bunlar cihazın gerçek dp ölçümü veya fiziksel 720p/1080p/4K doğrulaması değildir. Responsive senaryolar dp/fontScale/inset hesaplarını ayrıca sınar. JVM, Android view lifecycle/FocusFinder/requestFocus/LibVLC veya React onPress render akışını taklit etmez. Inspector eşdeğerlik testi observer'ın state dışı etkisizliğini sınar; gerçek iki pencere callback'i eşdeğerliği cihazda kabul edilir.

## Universal APK hazırlığı ve fiziksel kumanda planı

Yeni APK bu tur üretilmedi. APK #504 eski SHA'ya aittir; yeni düzeltmeyi içermez. Yeni fiziksel test APK'sı, bu PR'ın raporlanan **yeni exact HEAD SHA**'sından `.github/workflows/android-apk.yml` / `apk_mode=universal` ile üretilmelidir. ARM64+ARMv7, LibVLC, launcher/paket/imza/versionCode denetimleri mevcut workflow'da korunur. Artifact/checksum henüz yoktur; kaynak SHA ile APK dosya SHA256'sı karıştırılmamalıdır.

1. Homatics'te APK kaynak SHA'sını doğrula; Xtream ile Home aç. Inspector kapalıyken menü Home→Live→Movies→Series ve geri geç; OK'nin ekrandaki gerçek focus'u seçtiğini gözle.
2. Home menü DOWN→Hero→raf; UP ile geri. Raf sonuna RIGHT: başka rafa atlamamalı. DOWN/UP bitişik rafı seçmeli.
3. Live kanal→favori→kanal, dört yön; Movies/Series son sütun ve eksik son satır. Her adımda beyaz çerçeve ve görünür hedef kaydedilsin.
4. Tek basış bir adım; uzun basış kontrollü repeat; bırakınca 10 saniye bekle. Focus kendi kendine değişmemeli.
5. Listenin yüklenmesini ve sayfalanmasını bekle; scroll sonrası hedef görünür ve OK'nin açtığı öğeyle aynı olmalı. Kategori drawer aç/kapat; eski geçerli focus'a dön.
6. Player aç→OK kontroller→kanal/ses/altyazı paneli→Back panel→Back kontroller→Back katalog. Aynı kategori/kanal ve geçerli focus dönmeli; TV launcher'a düşmemeli.
7. Inspector aç: kompakt panelde tuş, gerçek hedef, beklenen hedef, owner ve sonuç kaydet. Aynı zinciri tekrarla; Inspector gezinmeyi değiştirmemeli. Gerekirse geçmişi Ayarlar'dan aç, sonra kapat; beklerken restore sıçraması olmamalı.
8. Aynı testleri M3U ve Stalker'da; telefon orientation ve TV Preview'da tekrarla. Cihazın desteklediği 720p/1080p/4K çıkış ve fontScale koşullarını dp ölçümünü ayrıca kaydederek dene.

Kabul için her temel bölüme ulaşım, doğru OK, görünür/kararlı focus, Player çıkışı ve katalog restore Homatics videosuyla doğrulanmalıdır.
