# Açık İş ve Kusur Defteri

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
