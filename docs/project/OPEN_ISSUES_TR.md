# Açık İş ve Kusur Defteri

## Güncel fiziksel bulgu kaydı — 18 Ekim / Home & Remote Repair

Videolar `1000304408.mp4` (Homatics) ve `1000304369.mp4` (Poco) erişildi; seçilmiş kareler incelendi. Tam frame-by-frame video incelemesi yapılmadı. APK #506 / run 39131986336 / `ed94a373ce64ff1a006c27b712b731a8ed1eda3e` remote SUCCESS; videolarda uygulama içi build kimliği yok. Dolayısıyla video→APK/SHA eşlemesi kesin kabul edilmez, kusurlar yine geçerlidir.

| ID / öncelik | Bulgu / tekrar adımı | Kaynak sahibi / uygulama | Güncel durum |
|---|---|---|---|
| TV-005 / P0 | Film Info aç → Geri/İzle'ye DPAD/OK ile erişim ve Back dönüşü başarısız | MovieInfoModal + native remote: Dialog onShow native modalShown; gerçek window callback, registered target/scope/currentFocus yeniden okunur; Play synchronous gate, stale callback kapanır | SOURCE_FIXED / PHYSICAL_RETEST_REQUIRED; Android olay iziyle kök neden kesinleştirilmedi |
| TV-006 / P0 | Yayın başarısız → hata ekranından çıkış güvenilir değil | PlayerChromeV2 kalıcı retry/exit; player-error scope, hidden input semantiği kapalı; CompatibilityV2 hata Back çıkışı ve mevcut resolver üzerinden retry | SOURCE_FIXED / PHYSICAL_RETEST_REQUIRED |
| TV-007 / P1 | Kanal paneli aç → görünmeyen satırda seçim değişebiliyor | PanelContent sabit 72dp row hesabından değişken başlık ayrıldı; TV clipping kapalı; native requestRectangleOnScreen korunur | SOURCE_FIXED / PHYSICAL_RETEST_REQUIRED; tek kanıtlanmış kaynak geometri kusuru, cihaz kök nedeni için event izi gerekir |
| TV-008 / P1 | Player odak etiketleri kesiliyor | PlayerRemotePressable etiket hedef içinde, iki satır | SOURCE_FIXED / PHYSICAL_RETEST_REQUIRED |
| PLAY-001 / P1 | Homatics yaklaşık 01:07 Live başarısızlığı | Video genel mesajı network/auth/resolver/decoder ayrımı sağlamaz; codec arızası ilan edilmedi | OPEN; gizli veri içermeyen provider/resolver/VLC olay izi gerekli. Çıkış onarımını engellemez |
| UI-004 / P1 | Poco Preview Hero şerit; kumanda içeriği örtüyor | HomeDiscovery okunur alt sınır; ProductShell/TVPreviewControls ayrı alan; Info modallarında kendi dock'u/viewport sahipliği | SOURCE_FIXED / PHYSICAL_RETEST_REQUIRED |
| UI-005 / P1 | Player→Series Info dönüşünde seçili sezon ekran dışında | SeriesInfoModal: ayrı seasonStrip ref + exact selected-ID index / onShow / content-size restore | SOURCE_FIXED / PHYSICAL_RETEST_REQUIRED |
| UI-006 / P1 | Mobil/TV eski Home ve uygunsuz açılır bölüm menüsü | HomeDiscovery featured başlık, görsel/fallback/loading/CTA; ResponsiveContentNav beşli mobile + library | SOURCE_IMPLEMENTED / VISUAL_REVIEW_REQUIRED; tam Elite dönüşümü değil |
| PREVIEW-004 / P2 | Kategori Dialog'unda Activity dock'u erişilebilir değil | Film/Series Info kendi dock'unu aldı; kategori Dialog dock'u ayrıca uzlaştırılmalı | OPEN; kategori seçimi dokunmatik/Native ile sürer, Preview tam kumanda parity iddiası yok |

Inspector odağı çalıyor varsayımı yapılmadı; overlay focus alamayan tanımı korunur. Inspector açık/kapalı fiziksel karşılaştırma henüz yok. Tarihsel TV-001/002 FAIL, yeni kaynak NOT TESTED, TMDB LIVE BLOCKED ve legacy 14 SKIP / 0 DELETED değişmedi. U4.2/U4.3 kaynak kapsamı tekrar OPEN yapılmadı.

---

Durumlar: OPEN, SOURCE_INTEGRATED, AUTO_VERIFIED, DEFERRED_RC, BLOCKED. Fiziksel durumlar PASS/FAIL/NOT TESTED/BLOCKED/PARTIAL ayrıca tutulur. Yeni kullanıcı kusuru mevcut kayıtla ilişkilendirilir; ciddi teknik zorunluluk yoksa entegrasyon sırasını bozmaz.

| ID / öncelik | Ekran ve cihaz | Kaynak/kanıt | Geliştirme / fiziksel durum | Sonraki eylem / sorumlu |
|---|---|---|---|---|
| TV-001 / P0 | Homatics 4K V2: focus/selected görünürlüğü, Player kontrolleri ve çıkış | #135 Universal APK #487 kullanıcı bulgusu; bu ilk bulgu için exact build SHA burada yeniden kanıtlanmadı | Tarihsel Physical FAIL açık; kaynak onarımları #136–#138 üzerinden U1'de, güncel kaynak fiziksel NOT TESTED | RC'de aynı Player/Back ve katalog dönüş senaryosu; Native input hattı |
| TV-002 / P0 | Homatics: Home/DOWN/raflar ve kumanda kararlılığı | Eski APK #504 kullanıcı bulgusu; exact test SHA bu kayıtla doğrulanmış sayılmaz. #138 kaynak 7591b3c; docs/tv/PR138_P0_FOCUS_REPAIR_TR.md | Physical FAIL devam; üç source fix U1.1'de, yeni cihaz kanıtı yok | U1 otomatik policy/render; fiziksel retest yalnız RC onayıyla |
| TV-003 / P1 | Home Hero yüksekliği / ilk raf | nativeTvHomeLayout + HomeDiscovery; docs/tv/PR138_HOME_COMPACT_REACHABILITY_TR.md | SOURCE_INTEGRATED; geometri/JVM/render testleri; gerçek Android NOT TESTED | Extreme font/safe-area ve görünür hedef kabulü RC'de |
| TV-004 / P1 | Stalker Native Live hedef bölgesi | #139 `stalker-live:` hedefleri #138 sınıflandırıcısında `content` oluyordu; red/green regresyonu | SOURCE_FIXED; 27-senaryolu native remote kapısı; Physical NOT TESTED | U1 exact-HEAD Quality; resolver değişmez |
| UI-001 / P1 | Telefon landscape katalog policy | #128/#129 device/presentation politikası; usePlayerOrientation | OPEN; #123'ün Poco 13/13 PASS'i yeni policy'ye devredilmez | #124/#133 ile ürün davranışını uzlaştır; ortak sunum hattı |
| UI-002 / P1 | Mobil/tablet/Preview grid ve Home | U2: useResponsiveCatalogGrid, catalogGridLayout, homeHeroLayout, HomeDiscovery | SOURCE_INTEGRATED / NOT TESTED; exact-HEAD Quality gerekir | Yeni viewport/font/scope otomatik kapıları; gerçek kabul yalnız RC |
| UI-003 / P1 | Tablet rotation/scroll | U2 stable-ID anchor ve üretim hook senaryoları | SOURCE_INTEGRATED / NOT TESTED; gerçek Android viewability/layout kanıtı yok | RC rotation + scroll + selected Info/season durumunu doğrula |
| ELITE-001 / P1 | Home/Live/Player/overlay bütün cihazlar | #139: gerçek Elite Live yalnız Native TV; showcase üretim Home/Player değil | PARTIAL / NOT TESTED | Ortak marka ve action modeli; cihazlara uygun yerleşim |
| INFO-001 / P1 | Home→Film Info | U4.1 Xtream/M3U + U4.2 Stalker kaynak ve regresyon testleri | SOURCE_INTEGRATED / fiziksel NOT TESTED | RC kabulü; Stalker sayfa-locator sınırlaması U42-LOOKUP-001 açık |
| INFO-002 / P1 | Home/Series→yerel dizi bilgisi→bölüm | U4.3 ortak SeriesInfoModal, Paged flow, Stalker targeted detail | SOURCE_IMPLEMENTED / fiziksel NOT TESTED | Final exact-SHA Quality + sonraki RC kabulü |
| SERIES-META-001 / P2 | Dizi metadata | Mevcut MovieInfoService film odaklı; film endpoint'i dizide kullanılmaz | DEFERRED; TV metadata backend yok | Ayrı, sınırlı TV metadata sözleşmesi; deployment bu dilimde yok |
| TMDB-001 / P1 | Metadata live bütün cihazlar | #140–#142 mock matcher/cache/proxy; gerçek deployment/session/secret kanıtı yok | **TMDB LIVE BLOCKED** | Hosting kullanıcı seçimi/onayı, HTTPS + trusted issuer + server token + atıf. Netlify kullanılmaz; sunucu dağıtılmaz |
| PERF-001 / P1 | Startup/playback ölçüm | U3 #130 adaptasyonu; performanceDiagnostics + üretim olayları | SOURCE_INTEGRATED / Physical NOT TESTED | RC gerçek cihaz örnekleri; ölçülmemiş hız yüzdesi yok |
| CACHE-001 / P1 | Refresh/provider switch | U3 #131 adaptasyonu; CatalogSync + retained-window + M3U transaction gate | SOURCE_INTEGRATED / Physical NOT TESTED | RC offline/switch/yenileme ve aynı scroll/selection/focus kabulü |
| HYGIENE-001 / P2 | Araç zinciri/API/ek CI | #120 | Yalnız scripts root typecheck TS18003 onarımı alındı; PR bütünü OPEN | Kalan #120 semantik uzlaşması; tam PR tamamlandı sayılmaz |
| LEGACY-001 / P2 | 14 onaylı eski branch | 17 Ekim legacy temizliği: **0 DELETED / 14 SKIP / 0 FAILED**; deployment/environment okunamadı ve ref-delete kabiliyeti yok | SKIP / RETAIN; yönetim borcu | Erişim geldiğinde exact-ref ve dependency gate'i yeniden yap; U1'i durdurmaz |
| ADMIN-001 / P1 | GitHub yönetim koruması | Son okuma main ve 14 stacked parent protection yok; rulesets=[] | BLOCKED; auto-merge/delete kapalı | Yetkili settings erişimiyle koruma ve required typecheck kaynak doğrulaması; hiçbir bypass yok |

Güncel karar tablosu yukarıdadır. Aşağıdaki U2/U3/U4.1/U4.2 aşama notları tarihsel olarak korunur; U4.2 film işi güncel tabloda OPEN değildir.

## Legacy SKIP kapsamı — kaybolmayacak liste

`diag/r18-e0p-stalker-epg-probe`, `feat/epg-stream-info`, `feat/premium-player-chrome`, `feat/r18-ui-presentation-foundation`, `feat/stalker-live-catalog-parity`, `feat/stalker-live-parity-current-main`, `fix/large-xtream-anr`, `fix/large-xtream-epg-memory`, `fix/large-xtream-oom-hardening`, `fix/player-controls-regression`, `fix/release-vlc-patch`, `fix/stalker-product-parity-d12-v2`, `fix/stalker-product-parity-d12`, `fix/xtream-real-login`.

Bu U1 görevi branch silme, mevcut PR merge/close/Ready/retarget veya otomatik merge yetkisi vermez. Tarihsel fiziksel senaryoların adımları docs/tv belgelerinde korunmuştur; oradaki APK hazırlık adımları bu aşamada yürütülmez.

## Tarihsel U2 sonrası açık sınırlar

- UI-001 kapanmadı: telefon katalog portrait kilidi korundu; geçici landscape viewport geometri desteği serbest rotation kabulü değildir.
- #121 kompakt katalog header ve detail panel tasarım farkı DEFERRED; shared grid + iki satır fontScale başlığı üretime alındı.
- Preview row restorasyonu görünür hedef ve aktif scope doğrulaması ister; sanal D-pad testi Native fiziksel Focus PASS değildir. Host hook ve React host render gerçek Android layout testi değildir.
- ELITE-001 / INFO-001, Native TV Physical FAIL ve TMDB LIVE BLOCKED kapanmadı. Legacy 14 SKIP listesi aynen geçerlidir. Yeni APK veya fiziksel test yoktur.
- U3: #130 gözlem/performance ve #131 cache-first refresh; callback ömrü, generation/cancel, stale cache ve provider identity regresyonlarıyla uzlaştırılacak.

## U3 açık sınırlar ve çözülen kaynak kusurları

| ID | Durum | Kanıt / sonraki eylem |
|---|---|---|
| U3-FIX-01 | SOURCE_FIXED | Geç snapshot timestamp'i ownership guard arkasına taşındı; üretim coordinator host testi |
| U3-FIX-02 | SOURCE_FIXED | #131 M3U sahiplik release sonrası kontrolü başarıyı false yapıyordu; finishOwnedCatalogCommit sonucu release öncesi doğrular |
| U3-FIX-03 | SOURCE_FIXED | Refresh revision'ı listeyi boşaltıyordu; mevcut pencere korunur ve yeni pencere tek yayında değişir |
| U3-FIX-04 | SOURCE_FIXED | M3U queued/staged yazımda artık current ownership ve transaction assertStillOwned kontrolü var |
| PERF-002 / P2 | OPEN / NOT OBSERVED | Android native heap/PSS ve gerçek ilk piksel/ilk frame ölçümü yok; JS heap yalnız runtime sunuyorsa numeric gözlem |
| PERF-003 / P2 | PARTIAL | FIRST_CATEGORY veri hazırlığı, FIRST_CONTENT paged React commit içindir; Stalker lazy VOD/Series iç fazları ve gerçek görünürlük ayrı ölçüm ister |
| CACHE-002 / P1 | OPEN | Kalıcı SQLite katalog toplam disk boyutu/row eviction kotası kaynakta yok; ürün veri kaybını önleyen bütçe tasarımı ayrı dilim |
| CACHE-003 / P2 | OPEN | M3U transport abort bu dilimde eklenmedi; mevcut 20s fetch timeout + generation discard + queued/SQL publication iptali korunur |
| CACHE-004 / P2 | DOCUMENTED | Otomatik hata aynı activation/timestamp/policy anahtarında döngüsel retry yapmaz; manuel yenileme, provider aktivasyonu veya politika değişimi yeni denemeyi açar |

ELITE-001, INFO-001 ve UI-001 açık kalır. Native TV tarihsel **Physical FAIL**, güncel birleşik kaynak **NOT TESTED / DEFERRED_RC**, **TMDB LIVE BLOCKED** ve legacy **14 SKIP / 0 DELETED / 0 FAILED** değiştirilmedi.

## Tarihsel U4.1 güncellemesi

- **U4-ACTION-001 / PARTIAL**: Xtream/M3U Home film → mevcut Film Info kaynak yolu eklendi. Provider değişimi, kaldırılan içerik, eski callback ve çift Play otomatik kontrol altında. Native fiziksel Back/scroll/focus restorasyonu **NOT TESTED / DEFERRED_RC**.
- **U4-ACTION-002 / OPEN / P1**: Stalker Home seçimi gerçek filme Info açmak yerine Movies sekmesine gider. Özet yalnız portal ID/sunum alanları içerir; cmd veya oturum URL'si saklanmaz. Sonraki iş: seçilen portal ID'yi güncel session'da yeniden bulma ve iptal/sahiplik korumasıyla ortak Info akışı. Stalker resolver'ı bu dilimde değiştirilmedi.
- **U4-ACTION-003 / OPEN / P1**: Home Series → Series Info eylem ve metadata parity tamam değil. Tam Elite Home/Live/Player/overlay işleri açık.
- Tarihsel Native TV **Physical FAIL**, TMDB **LIVE BLOCKED**, legacy cleanup **14 SKIP / 0 DELETED** aynen sürer. Yeni fiziksel kabul veya APK yoktur.

## Tarihsel U4.2 açık kapsam ve sınırlı kapanış

- **U4-ACTION-002 / SOURCE_IMPLEMENTED**: Stalker Home seçimi artık Movies sekmesine atmak yerine portal ID'ye ait Film Info açar. Info açılışı provider playback isteği yapmaz. Runtime session replace/release ve provider değişimi bekleyen Play'i iptal eder; eski select/close/play callback'leri yeni seçim/session'a etki edemez. Fiziksel kabul bekler.
- **U42-LOOKUP-001 / LIMITATION / P1**: Mevcut VOD servisinde kanıtlanmış doğrudan ID detay endpoint'i yok. Bir kayıtlı kategori/sayfa güncel okunur; legacy summary için All/ilk kategori sayfa-1 kullanılır. İçerik bu sayfadan taşındıysa yanlış filme veya tam katalog taramasına düşmez; hata+tekrar dene gösterilir. Kullanıcı Filmler kataloğunu yenileyip Home özetini güncelleyebilir. Daha geniş yeniden bulma yalnız kanıtlı hedefli provider sözleşmesiyle ayrı incelenir.
- **U4-ACTION-003 / DEFERRED_U4.3 / P1**: `StalkerMainPage` Home dizisi yalnız sekmeye gider; `OptimizedHomeScreenPaged` Home seri seçimini ayrı screen/return origin ile uzlaştırmalı. `StalkerSeriesProductSurface` Golden detail'i yalnız başlık/sezon/bölüm sunar; ortak Elite Series Info/metadata yok. Yeni kapsam: exact provider+series seçimi, mevcut targeted detail yükleme, sezon/bölüm kimliğiyle playback, cancellation, doğru Home/Series dönüşü, Back/Focus ve yerel fallback. Tüm protokolleri birleştiren resolver veya yeni kapsamlı detail mimarisi bu dilime eklenmedi.
- **U42-PHYSICAL / NOT TESTED / DEFERRED_RC**: Android Modal native focus geri alma, gerçek D-pad/Back sırası, yatay raf ve dikey scroll/orientation restorasyonu yalnız RC'de kullanıcı onayıyla doğrulanacak.
- Native TV tarihsel **Physical FAIL**, **TMDB LIVE BLOCKED**, legacy cleanup **14 SKIP / 0 DELETED** ve U3 disk/LRU/network abort borçları değişmedi.

## U4.3 güncel kapanış ve kalan işler

- **U4-ACTION-003 / SOURCE_IMPLEMENTED**: Xtream, gerçek M3U cached hierarchy ve Stalker Home/katalog → aynı yerel dizi bilgisi → exact sezon/bölüm → mevcut Player yolları bağlandı. Player'dan aynı detay durumuna, detaydan kaynak ekrana dönüş sözleşmesi var; fiziksel kabul verilmedi.
- **U43-DATA-001 / SUPPORTED_CONDITIONALLY**: M3U yalnız mevcut parser/persistence'ın sunduğu seriesGroups'u açar. Sıradan live/VOD playlist veya kaldırılmış cached group için sezon/bölüm üretilmez; hata ve yeniden deneme vardır.
- **U43-META-001 / DEFERRED**: TV TMDB detay servisi/endpoint entegrasyonu yok. Provider yerel görsel, özet/tür ve mevcut episode alanları kullanılır. Eksik süre/açıklama uydurulmaz. Stalker normalize edilmiş episode DTO'su bu ek alanları sunmuyorsa boş kalır.
- **U43-RC-001 / NOT TESTED / DEFERRED_RC**: Gerçek telefon/tablet/native/Preview'da modal ilk odak, scrolling, aynı kart ve raf restorasyonu, orientation ve Player Back sırası fiziksel kanıt bekler. Player içindeki Next ile detay ekranının en son çalınan bölüme senkronizasyonu yeni kapsam değildir; son detay seçimi korunur, mevcut Player queue/progress davranışı değiştirilmez.
- Native TV tarihsel Physical FAIL, TMDB LIVE BLOCKED ve legacy 14 SKIP / 0 DELETED aynı kalır. U4 bütünü PARTIAL.


## Home & TV UX kapanışı — 18 Ekim 2026

Başlangıç kaynak: `f24461c79a0e88fa24911db5952fc26d06dba2d2`, PR #143 Draft,
`integration/legendstream-u1` → `feature/r19-tmdb-secure-proxy`.

| Alan | Bu dilimde kaynak durumu | Kabul sınırı |
|---|---|---|
| TV ana Live | Native yenilemede liste mount'u korunur; yatay nav dikey alanı büyütemez; dar viewport'ta bilgi paneli %25 ile sınırlanır; kanal OK mevcut onOpen'u çağırır | Homatics görünmez kanal bulgusunun fiziksel kök nedeni/çözümü henüz ölçülmedi; açık |
| Live durumları | Güvenli paging hata mesajı, yükleniyor ve boş durum ayrıldı; focus scroll ile seçimi değiştirmez | Ana liste host testi Player çekmecesinden ayrıdır; Android piksel/katman ölçümü değildir |
| Home Hero | Xtream/M3U İzle mevcut scoped controller üzerinden mevcut movie resolver'a gider; Bilgi ayrı callback; dizi Bölümleri Gör; Stalker güvenli doğrudan yol verilmediğinde Film Bilgisi | Yeni resolver yok; büyük yazıda minHeight ile büyüme; TV raf görünürlüğü gerçek cihazda açık |
| Film/Dizi modal | Mevcut modalShown/scope/back ownership korundu; kategoriye görünür Kapat, geç scope hazır bildirimi, Preview viewport/dock ve keyboard avoidance eklendi | Native Dialog/Back fiziksel doğrulaması açık |
| Player hata | Retry eski VLC callback sahibini eşzamanlı iptal eder; tekrar basış kilidi; Back çıkışı; kanıtsız codec teşhisi kaldırıldı | Yayın hatasının ağ/resolver/VLC kök nedeni çözülmüş sayılmaz; gecikme ölçülmedi |
| Mobil gezinme | Beş mevcut sekme ve tek mevcut state korunur; Canlı ara metni görünür; klavyede bar gizlenir | 393/873 ve 1280/800 host matrisi; yatay telefon alt barı 48dp hedeflerle kalır; yan düzen eklenmedi |
| Dizi dönüş | Sezon şeridi dikey bölüm listesinden ayrıldı; seçili sezon merkezi ve bölüm offset'i bağımsız restore edilir | Host modal handler testi; Android kaydırma kabulü değildir |

Otomatik kanıt: genişletilmiş Visible Home/remote production host 15/15; U4.3 32/32;
Native Home render 33/33 + responsive render 30/30. Bunlar host/model kanıtıdır.
Son committen sonra exact-SHA Quality ve Universal APK çalıştırılması teslim kapısıdır;
koşu linkleri ve sonuçları PR açıklamasında ve Türkçe teslim raporunda kaydedilir.
Native Kotlin bu dilimde değiştirilmedi. Yerel Android SDK/adb/emülatör yok;
Android derleme kanıtı yalnız final SHA Universal workflow sonucu ile verilebilir.

Genel durum **PARTIAL / PHYSICAL NOT TESTED**. Tarihsel Native TV **Physical FAIL**,
**TMDB LIVE BLOCKED**, legacy **14 SKIP / 0 DELETED** korunur. Bu kayıt yeni fiziksel
kabul oluşturmaz; fiziksel test başlatılmaz. Release Candidate onayı sonrası kart:
Poco: Hero İzle/Bilgi, kategori arama/klavye/yatay/büyük yazı, sezon dönüşü.
Homatics: ilk Live/kategori değişimi/Player dönüşü, 30 UP/DOWN hedef görünürlüğü,
OK doğru kanal, Film Info D-pad/Back, hata Retry/Back ve çift basış.

Sonraki tek sınırlı görev: bütünleşik RC üzerinde TV ana Live viewport ve modal/Back
akışının gerçek Android ölçümünü alıp açık Homatics bulgusunu kanıtla kapatmak.

Son erişilebilirlik düzeltmesi: Hero aksiyon grubuna wrap ve viewporta bağlı maxWidth, düğmelere maxWidth/flexShrink eklendi. 320dp/büyük yazı/yatay/TV host testiyle aksiyon sahipliği ve sınırlı kapsayıcı doğrulandı; gerçek Android metin ölçümü değildir. Visible Home/remote host 16/16. Önceki d1eaa0b kaynağının APK #507 koşusu bu son düzeltmenin teslimatı değildir; yeni final SHA için Quality ve Universal APK kapısı geçerlidir.


## PR #143 TV Adaptive UI — 2026-10-18 ara uygulama kaydı

- Başlangıç HEAD `95b70d4583adc5a311ce963c940f89bd467795c7`; Quality #1276 SUCCESS (run 39155078724).
- `e10be228be1b7749c10cbe2e209e82554bbab17c`: gerçek PagedCatalogViews `CatalogHeader` araması düğmeyle isteğe bağlı açılır; kapatma arama sorgusunu temizlemez. Live Elite panelindeki mevcut arama düğmesi korunmuştur.
- `f351fd177d414d635f7c41266b5856df46c48600`: `ResponsiveContentNav` Native TV yatay ScrollView yerine genişliği ve safe-area ile sınırlı, focusId korunan sarılabilir View kullanır. Mobil alt navigasyon yolu değiştirilmedi.
- **Durum PARTIAL / AUTOMATED QUALITY PENDING**: Bu kaynak değişiklikleri için exact-SHA Quality sonucu henüz kapanmamıştır. Üç katalog / üç provider yolunda D-pad arama input sahipliği, focus/scroll restore, tam ortak geometrik sistem, Live gerçek ölçüm ve loading-state doğrulaması, cihaz-parity regresyonları henüz kanıtlanmamıştır. Bu kalemler PASS değildir.
- Tarihsel Homatics Native TV Physical FAIL korunur. RC onayı olmadan APK veya fiziksel test yoktur. Merge yoktur. Quality PASS fiziksel kabul sayılmaz.


### PR #143 P0 TV UX devamı — 2026-10-18
- Quality #1288 önceki `8bf32a8334e18b18288e89a6232f2b4befecdfba` için SUCCESS. Yeni üretim HEAD aynı sonuçla karıştırılmamalıdır.
- `9df670ab`: EliteLiveCatalog gerçek FlatList `onLayout` viewport ölçümü; stacked küçük TV'de ayrıntı paneli listeyi dikey sıkıştırmaz; arama input odak ve liste offset restorasyonu; kategori değişimi dışındaki sorgular selectedId'yi sıfırlamaz.
- `326d89d6`: adaptif navigasyon senaryosundaki eski TV yatay ScrollView beklentisi, gerçek sabit View navigasyonu beklentisine değiştirildi; assertion gevşetilmedi.
- `a96b5a26`: eliteLiveLayout küçük stacked ekranlarda kategori/kanal panellerini sığdırır; metin fontScale'e göre ölçülendirilir.
- `95bfe09b`: Native TV Live geometri ve focus/selection ayrım senaryoları eklendi.
- **PARTIAL:** Native renderer ölçümleri, ilk kanalın kumanda ile cihazda odaklanması, otomatik kapsamın tüm kombinasyonları, tüm katalog aramalarında focus-restore, Hero/raf/adaptif ortak geometri hâlâ açık. Final exact-SHA Quality tamamlanmadan PASS yazılamaz. Physical NOT TESTED / DEFERRED_RC; geçmiş Native TV FAIL korunur. Merge/APK yok.


### PR #143 P0 closure gate — 2026-10-18
- Başlangıç HEAD `76c896a5ddd96ba0f98d43b25618876c40929ff6`; Quality #1305 FAIL, gerçek kırılma `Native TV Home helper and test formatting` adımında `tests/nativeTvHomeLayoutScenarios.ts` Prettier kontrolü.
- `910399498e68595e148b6037ba302abe0d07b6de`: test assertion silmeden/gevşetmeden format düzeltmesi; exact-SHA Quality #1307 başlatıldı.
- Geometri helper testleri gerçek Android FlatList renderer/mount, ilk kanal native FocusFinder UP/DOWN veya kategori geçişi kanıtı değildir. P0 bu kanıtlar olmadan PASS olarak kapatılamaz.
- Native TV Physical FAIL geçmişi korunur; Physical acceptance `DEFERRED_RC`. Yeni APK, branch, PR veya merge yok. Movies/Series genel arama ve ortak Hero/kart ölçeklendirme P1'de tutulur.


## PR #143 P0 TEST GATE — 2026-10-18

- Başlangıç Quality #1314 kaynak test dosyası Prettier kontrolünde FAIL. `nativeTvHomeLayoutScenarios.ts` formatı, daha önce Quality PASS almış kaynakla birebir geri eşitlendi; önceki Live assertions silinmeden `eliteLiveLayoutScenarios.ts` içine taşındı.
- `tvP0ProductionRenderScenarios.mjs`: gerçek `EliteLiveCatalog` ve `ResponsiveContentNav` kaynakları esbuild ile derleniyor. React Native bağımlılıkları test host adaptörüyle modellenerek FlatList veri/row renderer, focusId, onPress callback, arama input toggle, selection/scroll restore, viewport `onLayout`, dört sekme render/route testleri çalıştırılıyor.
- Quality #1327 (run `39160376404`) SUCCESS, commit `ac868212f4ecdf1f7a30c45b9f181b1410a9dfec`. Son belge commit HEAD için ayrıca exact-SHA Quality zorunludur.
- Otomatik SOURCE kanıtı host renderer ve olay callback sözleşmeleriyle sınırlıdır; gerçek Android layout/clipping/z-order, FocusFinder DPAD yolu, klavye sahipliği ve TV Preview fiziksel akışı bu host tarafından taklit edilemez. `P0 PHYSICAL: PENDING / DEFERRED_RC`; tarihsel Native TV Physical FAIL değişmemiştir.
- P1 Movies/Series arama mimarisi ve Hero/kart ölçekleme kapsam dışıdır. Merge/APK/physical test yapılmamıştır.

## PR #143 P1 — 2026-10-18 kaynak ilerleme kaydı

- Başlangıç SHA `e0d0b3f1571dd0a13742817eec40bc5e0ccd0ed5`, Quality #1329 SUCCESS (run 39160710808).
- Üretim commit `6a7172bfd2b11d107243edeadf945b03f2a36f57`: `PagedCatalogViews.tsx` içindeki ortak Movies/Series `CatalogHeader` araması açılınca `TextInput` odak isteği, kapanınca blur ve kapsamlı erişilebilirlik etiketi. Kategori, arama callback, film/dizi kimliği ve resolver değiştirilmedi.
- Bu P1 **PARTIAL** kaydıdır; Home/Hero/kart responsive parity, arama sonrası gerçek TV/Preview focus restore, tam katalog araması, yeni üretim host testleri, provider/Player regresyonları henüz kapatılmadı. Quality #1331 (run 39163343206) sonuç doğrulaması gerekir; belgelerden sonraki exact-SHA Quality ayrıca zorunludur.
- Native TV Physical FAIL ve TMDB LIVE BLOCKED açık kalır; Phone/Tablet/Native TV/Preview Physical PASS ilan edilmez. APK, merge ve fiziksel test yapılmaz; RC aşamasına ertelenir.

## PR #143 P1 adaptif yerleşim — 2026-10-18 (kısmi kaynak teslimi)

- Başlangıç SHA `f561873770f86d8da8673071f7f631e3a72c6b99`; Quality #1333 SUCCESS (run 39163428311).
- Home gerçek üretim Hero bileşeninde `tvViewportHeight`, safe-area ve fontScale ile kompakt/Preview Hero yüksekliği bütçesi düzenlendi; raf için görünür alan rezervi korunmaya çalışılır. Native TV'nin `nativeTvHomeLayout` ve Focus akışı değiştirilmedi.
- `useNativeTvCatalogGrid` yön değişiminde eskimiş ölçülen liste genişliğini geçersiz kılar; ölçülen hücre genişliği aynı hook üzerinden `useResponsiveCatalogGrid` ve iki üretim Movies/Series `GridCard` başlık bütçesine bağlandı. Film/dizi seçim kimliği, Info callback ve player resolver değiştirilmedi.
- Davranış testleri: `u2CatalogHookScenarios.mjs` gerçek hook resize senaryosu; `nativeTvHomeRenderScenarios.mjs` gerçek Hero üretim render'ında iki viewport/Preview senaryosu. Bunlar Android layout/focus fiziksel kanıtı değildir. Yeni Movies/Series tam bileşen render host matrisi, tüm cihaz/parity kabulü ve gerçek cihaz erişilebilirliği henüz **AÇIK**; P1 tüm kapsamı PASS ilan edilmez.
- Native TV Physical FAIL ve TMDB LIVE BLOCKED açık. Merge, APK, fiziksel test yapılmadı. Son belge SHA için exact-SHA Quality sonucunu ayrıca doğrula.

## PR #143 P1 Movies/Series source host kabulü — 2026-10-19

- Başlangıç HEAD `54f79ce89603e2c8e9bd3984ac4688d88cfb7d6b`; Quality #1353 SUCCESS.
- `tests/p1CatalogProductionHostScenarios.mjs` eklendi: gerçek `PagedCatalogViews.tsx` kaynaklarından `GoldenSeriesCatalog` ve `PagedMoviesCatalog` ve gerçek responsive/native grid hook'ları esbuild ile derlenir. Sekiz profil: telefon portrait/landscape, tablet portrait/landscape, 720x480 ve 1920x1080 Native TV, TV Preview, büyük fontScale. Render ağacında grid sütunu, Series kart/Focus kimliği ve OK callback, poster oranı, arama aç/kapat ve sorgu callback, filtreli sonuç/kategori callback; Movies Film Info -> Play exact stream_id -> Close kimliği; son testte viewport değişiminde Series scroll anchor restore doğrulanır.
- Mevcut Quality workflow'una bağımsız zorunlu P1 host testi eklendi; P0 assertion'ları, provider resolver, Live/Player ve Native focus üretim mantığı değiştirilmedi. İlk host derleme koşusunda Expo font loader kaynaklı kırmızı görüldü, esbuild packages external ile host bağımlılığı düzeltildi. Quality #1367 (run 39169476708) SUCCESS, P1 adımı PASS. Son scroll assertion'ını içeren #1369 (run 39169709065) ve belge commit'i için exact-SHA Quality ayrıca zorunludur.
- **Kaynak host testleri Android renderer/FocusFinder değildir.** Gerçek TV Focus geçişleri, input klavye focus/Back sahipliği, Movies/Series tam seçim modalı ve tüm Scroll fiziksel kabulü açık. Native TV Physical FAIL ve TMDB LIVE BLOCKED korunur; `PHYSICAL DEFERRED_RC`, `SOURCE/HOST` ayrı. APK/merge/fiziksel test yapılmaz.


## U4 Elite V2 parity — 19 Ekim 2026 güncel kaynak dilimi

Başlangıç `45db89f25dfb53d255a939cb8ffbf039ee3c68b2`; PR #143 Draft,
base `feature/r19-tmdb-secure-proxy`. Başlangıç exact-SHA Quality #1371
SUCCESS: https://github.com/d3vilsgo/Legend-Stream/actions/runs/39169832551 .
Üretim/test commit: `6240a3992643443806844a87c63bfeb1d8e8e542`.

Bu dilim **PARTIAL**: tüm Elite V2 ekranlarının görsel dönüşümü tamamlanmadı.
Film Info artık sağlayıcının mevcut başlık, görsel, özet, tür, oyuncu, yönetmen ve
 yıl bilgisini korur; TMDB yalnız eksikleri tamamlar. TMDB puanı ayrı TMDB kaynağıdır.
Aktif PlayerChrome TV zaman çizgisinin koordinat koruması başlangıçta zaten vardı; yeni onarım diye sayılmaz. Yeni sonlu pozitif süre kapısı aktif PlayerChrome merkez düğmeleri, mobil zaman çizgisi ve remote seek callback yoluna bağlandı. PlayerChromeV2 yardımcı yüzeyi de aynı kapıyı kullanır. Kumanda mevcut -10/+15 saniye eylemlerini kullanır. Sonlu pozitif süre yokken sarma devre dışıdır. Oynat/duraklat, çıkış ve merkez kanal/sarma
aksiyonları erişilebilir ad taşır. VLC/provider resolver değiştirilmedi.

Otomatik kanıt: Visible Home/Player production host 18/18; Film Info mock 35/35;
P1 Movies/Series production host 8/8 profil; U4.3 Series 32/32;
Home Film Info 15/15; orientation 14/14; U2 geometry 94/94, hook 10/10;
U3 coordinator 9/9, SQLite 6/6, performance 11/11, refresh 9/9;
Native Focus JVM 66/66, stability 21/21, reachability 93/93;
TMDB proxy mock 32/32. Typecheck ve değişen dört dosya Prettier PASS.
Bunlar gerçek Android renderer veya fiziksel kabul değildir.
Final doküman HEAD Quality sonucu ayrıca doğrulanacak; başlangıç #1371 yeni
kod için PASS sayılmaz. Yeni assertion eklendi; skip yok. Eski metadata başlık
beklentisi yeni sağlayıcı önceliği sözleşmesine göre kesin eşitlikle güncellendi.

Tarihsel Native TV Physical FAIL, güncel NOT TESTED / DEFERRED_RC,
TMDB LIVE BLOCKED ve legacy 14 SKIP / 0 DELETED korunur.
APK, fiziksel test, deployment, merge, base/PR durum değişikliği yapılmaz.

- SOURCE_FIXED: Film Info yerel başlık/metadata yerine TMDB'nin mevcut alanları ezmesi.
- SOURCE_FIXED / PHYSICAL_RETEST_REQUIRED: aktif PlayerChrome mobil bilinmeyen sürede sarma ve tüm cihazlarda sonlu olmayan süre kapısı. Aktif TV zaman çizgisinin koordinat koruması ALREADY COVERED; V2 yardımcı yüzeyi ayrıca sağlamlaştırıldı.
- OPEN: Home/Live/Movies/Series/Player ortak görsel durumlarının tüm üretim yollarında tam parity; bu dilim tam tasarım dönüşümü değildir.
- OPEN: Player tüm ses/altyazı/aspect hedeflerinin Native ve Preview gerçek odak/scope kabulü.
- OPEN: Önceki kayıtlardaki arama klavye/Back ve tüm katalog kapsamı, gerçek ekran clipping/scroll kabulü.

## U4.1 OwnTV StageRail ve Live adaptive integration — 2026-10-19

- Kaynak: OwnTV `cead977803d90bd62ece69b4140e373f01feddca`, `app/src/main/java/tv/own/owntv/features/shell/components/StageRail.kt` satır 77–86 (`HIDDEN`, `CAPSULE`, `OPEN`, `PINNED`) ve 196–201 (Focus etkisi). GPLv3 Kotlin kodu aktarılmadı; React Native davranışı bağımsızdır. OwnTV_Core `c14e944b8d17e5cbb559d116afb30dc3b34864cb` referans olarak tutulur, bu dilimde Core kodu değiştirilmez.
- Mevcut eşzamanlı kaynakta `ResponsiveContentNav.tsx` Native TV sol dikey rail, kompakt/odakla açık genişlik, aktif sekme ve fiziksel Focus ayrımı sağlar. `EliteLiveCatalog.tsx` / `eliteLiveLayout.ts` kanal öncelikli ölçülü kategori/kanal/detay panellerini ve scroll/OK kaynak kimliklerini korur. Bu üretim dosyaları eşzamanlı commit'lerden geldiği için üzerine eski blob yazılmadı.
- U4.1 test kabulü için mevcut `adaptiveNavigationScenarios.ts` yatay genişlik varsayımı yerine ölçülü StageRail sözleşmesine uygun güçlü kontrollerle düzeltildi. `tvP0ProductionRenderScenarios.mjs` gerçek navigasyon renderında `CAPSULE -> OPEN -> CAPSULE` ve aktif sekme/Focus ayrımını ölçer. Quality #1383, eski yatay `width: targetWidth` assertion'ında FAILURE; yeni #1399 (run 39174919257) sonucunu final SHA ile ayrıca doğrula.
- SOURCE/HOST kabulü Quality SUCCESS olmadan PASS değildir. Fiziksel Android FocusFinder / D-pad ve TV Box fiziksel kabulü `PENDING_RC`, önceki `Native TV Physical FAIL` ve `TMDB LIVE BLOCKED` aynen açıktır. Legacy cleanup 14 SKIP korunur. U4.2/3/4 ertelendi; Player/Back/provider resolver ve playback motoru değiştirilmedi. Merge/APK/fiziksel test yapılmaz.

## U4.1 OwnTV SOURCE-GUIDED TV rail + Live adaptive — 2026-10-19 final source gate

- OwnTV kaynak kanıtı: `ahXN00/OwnTV@cead977803d90bd62ece69b4140e373f01feddca`, `app/src/main/java/tv/own/owntv/features/shell/components/StageRail.kt` (77–85 RailState, 196–208 Focus); `features/live/LiveScreen.kt` (561–609 ölçülen panel payları); `ui/components/FocusTrap.kt` (24–29 / 66–82). Core: `ahXN00/OwnTV_Core@c14e944b8d17e5cbb559d116afb30dc3b34864cb`, `core/src/main/java/tv/own/owntv/core/content/SearchReader.kt` (28–55 / 100–140). GPLv3 Kotlin/Compose kodu taşınmadı.
- **IMPLEMENTED (kapsamlı olmayan U4.1 dilimi):** `ResponsiveContentNav.tsx` Native TV için bağımsız kompakt ikon / Focus ile açık dikey rail; mobil tablar ve TV Preview mevcut davranışları korunur. `OptimizedHomeScreenPaged.tsx` rail alanını içerik viewport'undan ayırır; Hero'yu dikey itmez. `FocusButton.tsx` kompakt ikonlarda erişilebilir konuşma etiketini ve fiziksel beyaz Focus çerçevesini korur. `eliteLiveLayout.ts` + `EliteLiveCatalog.tsx` ölçülen dp alanında kanal listesi lehine panel bütçesini sınırlar, kanal OK -> mevcut onOpen kimliği ve kategori/kanal Focus ayrımı korunur.
- **SOURCE/HOST PASS:** `tests/u41StageRailLiveHostScenarios.mjs` gerçek Native rail / Live kaynaklarını esbuild ile iki TV viewport'unda (720×480, 1920×1080), ayrıca Preview ve mobil ayrımında sınar: compact/open/compact, dört nav Focus kimliği ve callback'i, kategorilerin seçimi, kanal scrollIntoView, Focus sırasında oynatmama ve OK ile açma, detay paneli genişliği. `quality.yml` gate eklendi; mevcut P0/P1 testleri değiştirilmedi. Exact kod SHA `7a1e755f3b2b59ea505fb39604a3f24acc480866`: Quality #1407 run `39175271837` **SUCCESS**, başarısız adım yok. Son belge commit SHA'sında ayrıca Quality şarttır.
- **PARTIAL / DEFERRED:** U4.1 Native fiziksel FocusFinder, önceki içerik Focus kimliğine açıkça geri yönlendirme, HIDDEN/PINNED rail modları ve TV Preview'da aynı sol rail henüz tam kabul değildir. U4.2 katlanan Hero, U4.3 provider-scope Focus+scroll restorasyonu, U4.4 birleşik SearchReader semantiği ve controlled zapping **DEFERRED**. Xtream/M3U/Stalker resolver/session, Player/Back, TMDB ve cache sözleşmeleri değiştirilmedi.
- **PHYSICAL PENDING / DEFERRED_RC:** Native TV Physical FAIL geçmişi ve TMDB LIVE BLOCKED açık. Quality otomatik kaynak kabulüdür, fiziksel PASS değildir. Bu dilimde APK, merge veya fiziksel cihaz testi yapılmadı.

## U4.2 OwnTV-guided Collapsible Home Hero — 2026-10-19

- **SOURCE VERIFIED:** OwnTV `ahXN00/OwnTV@cead977803d90bd62ece69b4140e373f01feddca`, `app/src/main/java/tv/own/owntv/features/home/HomeScreen.kt`, satır 189–191 (`heroFocused` / `inRows`), 236–243 (`onNonHeroFocused` raf geçişi), 346–356 (katlanmış Hero altından UP ile geri dönüş), 450–453 (Hero Focus ile genişleme). Kotlin/Compose kopyalanmadı; LegendStream React Native üretim kodu bağımsız geliştirildi.
- **IMPLEMENTED / SOURCE-HOST PASS:** `components/home/HomeDiscovery.tsx` içinde yalnız Native TV için `heroInShelves` kontrolü; gerçek `HomeShelf` ve `HomeCountCard` focus callback'leriyle katlanma; `HomeHeroCarousel` birincil Focus kimliğini koruyarak geri genişleme; kompakt durumda ikincil aksiyonları erişim dışı bırakma; provider id değişince eski katlanma durumunu temizleme. U4.1 StageRail Focus girişi bu state'i değiştirmez; mobil/tablet/Preview Hero geometri politikası korunur. Mevcut Native TV hesaplanmış Hero bütçesi genişleme için esas alınır; kompakt TV Hero 96dp altına düşmez, eski touch minimum 310dp/160dp sözleşmeleri değiştirilmedi.
- **HOST TEST:** `tests/u42HomeCollapsibleHostScenarios.mjs` gerçek `HomeDiscovery`, `HomeHeroCarousel` ve `HomeShelf` üretim bileşenlerini esbuild ile derler: 720×480, 960×540, 1280×720, 1920×1080 Native TV; telefon/tablet portrait-landscape ve TV Preview; raf/hero Focus callback zinciri, 24 hızlı geçiş, kimlik korunması, kart scrollToIndex tetiklemesi, provider kimliği değişimi ve loading/empty/populated senaryoları. Ek `nativeTvHomeRenderScenarios.mjs`: Hero expanded/compact/restore yükseklik ve görünmeyen aksiyonların yokluğu. Quality'ye U4.2 host gate eklendi. Exact kod SHA `e48f17af5de71a6c5fff77b68ea4e3f39325d996`: Quality #1437 / run 39202319757 **SUCCESS**; U4.2 12/12 PASS, Native TV Home 33/33 PASS, U4.1 6/6 PASS, P0 18/18 PASS. Final belge SHA'sında ayrı exact-SHA Quality zorunludur.
- **SOURCE/HOST PASS ≠ PHYSICAL PASS:** Android FocusFinder, fiziksel D-pad UP/restoration, gerçek scroll offset stabilitesi ve hızlı fiziksel navigation kabulü `DEFERRED_RC`; önceki Native TV Physical FAIL ve TMDB LIVE BLOCKED açık kalır. U4.3 genel Focus/Scroll restorasyonu ve U4.4 unified search/zapping geliştirmeleri DEFERRED. Legacy cleanup 14 SKIP korunur. APK, fiziksel test, merge yapılmadı.


## U4.3 Focus/scroll restoration — 2026-10-19 güvenli dönüş dilimi

**Durum: PARTIAL. U4.3 bütün kabul matrisi tamamlanmadı.**
Başlangıç remote HEAD `47561b0d35a59d8d1b8f0a021ff5c41ee1656308`;
Quality #1439 (`39202640275`) SUCCESS. Üretim commit'i
`3102231972ba143d923a3af693e815edb85da08d`, tree
`ebdd671f0ca6614c54fcde27cdd9e66d066088c3`; yerel doğrulanan tree ile aynı.
PR #143 OPEN/DRAFT; branch `integration/legendstream-u1`,
base `feature/r19-tmdb-secure-proxy` korunur.

### SOURCE VERIFIED — OwnTV

Repository `ahXN00/OwnTV`, SHA `cead977803d90bd62ece69b4140e373f01feddca`.
Dosya: `app/src/main/java/tv/own/owntv/ui/components/FocusTrap.kt`.
[Kalıcı kaynak](https://github.com/ahXN00/OwnTV/blob/cead977803d90bd62ece69b4140e373f01feddca/app/src/main/java/tv/own/owntv/ui/components/FocusTrap.kt#L66-L115).
Kısa kanıtlar:
- L73: `repeat(RESTORE_MAX_FRAMES)`
- L77: `runCatching { scrollState.scrollTo(scrollOffset) }`
- L79: `if (!landed) landed = opener != null && runCatching { opener.requestFocus() }.getOrDefault(false)`
- L103: `runCatching { listState.scrollToItem(index, offset) }`
- L112: `private const val RESTORE_MAX_FRAMES = 10`
İki `restoreAfterDialogClose` overload'u scroll konumunu korurken modal penceresi
odağı bırakana kadar sınırlı deneme yapar. Lazy list sürümü hedefin oluşturulması
konusunu ayrıca ele alır. Compose FocusRequester, coroutine/withFrameNanos ve
ScrollState/LazyListState bağımlılıkları taşınmadı; GPLv3 kodu üretime kopyalanmadı.

### IMPLEMENTED — mevcut sahipler içinde bağımsız düzeltme

- `ProductShell.tsx`: mevcut `TVPreviewFocusProvider` provider kimliğiyle yeniden
  kurulur; ekran state'i ile Focus yaşam döngüsü aynı provider sınırındadır.
- `TVPreviewFocus.tsx` / `tvPreviewFocus.ts`: owner kapanınca eski ölçüm istekleri,
  kayıtlar ve Back kapsamları geçersizleşir. Alttaki modal üstte Player dururken
  kapanırsa dönüş zinciri kaldırılan modalı atlar. Yeni bir Focus yöneticisi yok.
- `SeriesInfoModal.tsx`: provider/detail/season/episode/visible bağlamı doğrulanır;
  scroll önce yapılır, geçerli Preview hedefi sonra mevcut owner'a teslim edilir.
  İçerik boyutu değişimleri aynı scroll'u sürekli tekrarlamaz. Kapatma, provider
  değişimi, sezon değişimi ve drag bekleyen isteği iptal eder. Silinen bölüm
  kimliğine Focus istenmez, scroll güvenli başlangıca döner. Native fiziksel
  restore sahibi `LegendStreamTvRemoteModule` olarak kalır.
- `useNativeTvCatalogGrid.ts` / `useResponsiveCatalogGrid.ts`: native pending
  anchor provider/kategori/sorgu scope değişiminde temizlenir; eski başarısız
  scroll callback'i yeni restorasyon işlemini çalıştıramaz.

### SOURCE/HOST sonuçları ve açık kabul

| Akış | Durum | Kanıt / açık sınır |
| --- | --- | --- |
| Series Info → Player → Info | SOURCE/HOST PASS (sınırlı) | Üretim modalı sezon/bölüm kimliğini ve bağımsız scroll'u korur; yeni stale callback testleri |
| Provider değişimi / modal teardown | SOURCE/HOST PASS (sınırlı) | Gerçek ProductShell key testi, gerçek SeriesInfoModal eski callback reddi, controller dispose yarışı |
| Silinen Series bölümü | SOURCE/HOST PASS | Silinen Focus hedefi çağrılmaz, offset 0; tüm katalog fallback'i değildir |
| Home Hero → Film Info → Home | PARTIAL | Mevcut Home Info/Player regresyonu; gerçek raf anchor dönüş matrisi eksik |
| Movies Info/Player/arama/kategori dönüşü | PARTIAL | Scope zinciri ve grid scope koruması; sanallaştırılmış kart dönüşü tüm yollarıyla doğrulanmadı |
| Home rafı → Player → aynı raf/kart | PARTIAL | Montaj/kimlik yolları korunur; tam scroll + Focus birleşik host kabulü eksik |
| Live kategori/kanal/Player/arama dönüşü | PARTIAL | Mevcut kanal OK, scroll, seçim ayrımı korunur; arama sonrası exact Focus dönüşü eksik |
| StageRail içerik gidiş/dönüşü | PARTIAL | 6/6 mevcut host; tüm fiziksel/native restore zinciri kanıtı değildir |
| Katlanan Hero | SOURCE/HOST PASS regresyon | 12/12 mevcut üretim host; modal/scroll birleşik kabulü PARTIAL |
| Telefon/tablet | SOURCE/HOST PASS regresyon | Mevcut mobil tab, keyboard/Back ve 8 katalog profili; tüm restorasyon yolları değil |
| Native TV / Google TV / Box | PHYSICAL PENDING | JVM politika/stability testi, Android FocusFinder kabulü değildir |
| TV Preview | SOURCE/HOST PASS regresyon | 32/32 input + modal scope zinciri; tam ekranlar arası dönüş matrisi PARTIAL |
| Player retry / hata Back | SOURCE/HOST PASS regresyon | Home/Player üretim host 18/18; motor/resolver değişmedi |

Yerel: U4.3 Series integration **40/40**, U2 production hook **10/10**,
U4.1 StageRail/Live **6/6**, U4.2 Home Hero **12/12**, P1 katalog **8/8 profil**,
Home/Player **18/18**, TV Preview **32/32**, native stability **21/21**,
Home reachability **93/93**. Typecheck ve değişen format-gated dosyalar Prettier PASS.
Mevcut test/assertion silinmedi, skip eklenmedi. Final doküman commit'i için
exact-SHA Quality ayrıca teslimde doğrulanır; #1439 yeni kodun kanıtı değildir.

### Sonraki kapsam ve değişmeyen sınırlar

Native silinen hedef fallback'i ve veri hazır → scroll → mount → Focus sırasının
Home/Movies/Live üretim bileşenlerinde uçtan uca kabulü açık. Aynı provider ID ile
session yenilenmesi mevcut resolver/session korumalarına dayanır; bu teslimde
global session-generation Focus matrisi tamamlanmadı. U4.3 COMPLETE ilan edilmez.
U4.4 Unified Search/zapping başlatılmadı. Merge, force-push, APK, fiziksel test,
Player engine değişimi ve TMDB deployment yapılmadı.
**Native TV Physical FAIL**, **TMDB LIVE BLOCKED**, **legacy 14 SKIP / 0 DELETED**
korunur. Fiziksel RC kabulü yalnız kullanıcı onayından sonra; host PASS fiziksel PASS değildir.
