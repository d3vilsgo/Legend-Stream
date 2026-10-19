# Geliştirme, Quality ve Release Kabulü

Son geometri kontrolü: Native Hero pager köşeden eylem satırına taşındı; Watch→Info→pager LEFT/RIGHT ve Hero↔ilk raf için beş yeni üretim-policy JVM senaryosu eklendi. Aşırı font ölçeğinde ikincil eyebrow yalnız başlığa yeterli yükseklik varsa gösterilir. Fiziksel kabul iddiası değildir.

## Güncel kabul — Visible Home & TV Remote Repair

Kullanıcı bu dilimde final exact-SHA Quality sonrası mevcut android-apk.yml üzerinden Universal denemesini ayrıca yetkilendirdi. Eski genel erteleme notları tarihsel politikadır; bu yetki otomatik fiziksel PASS, merge veya yeni APK tetikleme commit'i anlamına gelmez.

Yerel **77/77 Quality shell kapısı PASS**; yeni Home/nav/recovery host **10/10**, U4.2 host **13/13** (çift Play, unmount callback ve modal onShow ek kontrolleri), U4.3 **31/31**, Home render **33 Native + 30 handheld/Preview**. JVM gerçek üretim Java policy/stability/reachability testleri korunur. Yerel Node24 TSX IPC sınırında aynı girişler node --import tsx ile çalışır; CI Node22 standart komutları otoritedir. Final kod+bu dokümanların remote HEAD'i için yeni Quality logunda QUALITY_EXACT_HEAD eşitliği zorunludur; başlangıç yeşili devralınmaz.

Görsel kanıt: gerçek kullanıcı videosundan seçilmiş kareler yalnız önceki fiziksel bulguyu destekler. `scripts/build-home-review.mjs` başlangıç Home/nav ve güncel üretim bileşenlerini mobil portre/yatay-Preview/TV geometri simülasyonuyla karşılaştıran bağımsız web dosyası üretir. Örnek katalog, mock navigation ve playback yokluğu açıkça etiketlidir. Yerel Chromium yok; indirme geçerli ZIP sağlamadı. Browser/runtime screenshot doğrulanamadı, bu dosyanın bundle başarısı görsel kabul değildir. Gerçek Android/emulator render yok.

APK istenen input: branch integration/legendstream-u1; apk_mode=universal; dual_abi=false; catalog_benchmark=false. Mevcut araçta workflow_dispatch bulunmuyorsa engel raporlanır; yeni tetikleme commit'i eklenmez. Yeni APK varmış gibi kaynak/version/hash sunulmaz. Ayarlar'daki BuildIdentity derlenen EXPO_PUBLIC_GIT_SHA ve native installed versionCode gösterir; web/Expo Go native code yoksa açıkça belirtilir.

Fiziksel retest kapısı: Homatics Home Hero→ilk/alt raf→Film Info Geri/İzle/OK tek eylem→Player panel/hidden/error/exit→aynı kart; kanal panelinde gerçek görünen odak; Inspector açık/kapalı. Poco: portre/yatay/Preview, alt bar/klavye/kategori Back, Film Info, Series seçili sezon/bölüm ve viewport dönüşü. Provider/session switch sırasında eski eylem üretilememeli. Native Dialog, firmware remote, network ve yeni görsel tasarım **NOT TESTED / PHYSICAL_RETEST_REQUIRED**; kullanıcı testi gelmeden FAIL kapanmaz.

---

## Geçerli politika

**Quality PASS = exact HEAD üzerinde otomatik doğrulama. Physical PASS = ilgili cihazdaki gerçek kabul kanıtı.** Birbirinin yerine geçmez. Kaynak veya metadata sağlayıcısı destek bayrağı runtime kabulü sayılmaz.

U1.1 ve U2 kaynak birleştirmesidir. Fiziksel testler GLOBAL INTEGRATION & FEATURE COMPLETION boyunca bilinçli ertelenmiştir. Her push/PR için Universal APK yoktur. Bütünleşik RC hazır olmadan ve kullanıcı onayı alınmadan APK/fiziksel kabul başlamaz.

## U1.1 otomatik kapı

- #142 exact kaynak + #138'in üç commit'i; her cherry-pick kaynak SHA'sını commit mesajında taşır.
- Quality push filtresi `integration/legendstream-u1` içerir; PR hedefi #142 branch'idir. Checkout `pull_request.head.sha || github.sha`; bağımlılık kurulumundan önce `git rev-parse HEAD` ile eşitlik zorunludur.
- `QUALITY_EXACT_HEAD=<SHA>` satırı ve job summary, run/check metadata head_sha ile birlikte değerlendirilir. CI başarısı aynı HEAD'deki run üzerinden doğrulanır; stale sonuç kabul edilmez.
- JVM native focus/stability/reachability, Home dp/render, responsive/tablet/orientation, Preview, Player/Back/Inspector, Elite Live/Film Info ve TMDB mock/HTTP security kapıları korunur. Mevcut provider/katalog/credential/redaksiyon testleri kaldırılmaz.
- Root typecheck dahil uygulanabilir yerel doğrulamalar ve bilinen kapsam istisnaları entegrasyon ledger'ında kaydedilir.
- APK workflow'larına U1 eklenmez. Eski `native-tv-parity-universal.yml` yalnız #136/#137 kaynak adlarını, `android-apk.yml` yalnız #134/#135 push adlarını ve v* tag'lerini eşler; U1 push ve bu Draft PR bunları tetiklemez. Bu kaynak branch'lere bu görevde push yapılmaz.

## Fiziksel kabul matrisi

| Profil | Tarihsel kanıt | U1 birleşik kaynak durumu |
|---|---|---|
| Homatics 4K V2 | #487 açılış/temel remote PARTIAL; ürün kabulü FAIL. #504 kumanda/focus FAIL bildirimi devam | **NOT TESTED / DEFERRED_RC**; tarihsel FAIL silinmedi |
| Poco X7 Pro / Android 16 | #123 kapsamında telefon için 13/13 bildirilmiş PASS; eski orientation FAIL kayıtları kendi kaynaklarında kalır | **NOT TESTED / DEFERRED_RC**; yeni #129/U1 policy için miras PASS yok |
| Tablet portrait/landscape | Fiziksel kanıt yok | **NOT TESTED / DEFERRED_RC** |
| Diğer Android TV / Google TV / TV Box | Fiziksel kanıt yok | **NOT TESTED / DEFERRED_RC** |
| Telefon/tablet TV Preview | Bu birleşik kaynak için fiziksel kanıt yok | **NOT TESTED / DEFERRED_RC** |
| TMDB live bütün cihazlar | HTTPS/issuer/token canlı bağ kanıtı yok | **BLOCKED**; mock PASS canlı kabul değildir |

## RC için minimum senaryolar — henüz uygulanmayacak

1. Home→Hero DOWN→ilk gerçek kart, raflar arasında UP/DOWN ve row sınırlarında LEFT/RIGHT; offscreen hedef görünür olmalı; Inspector açık/kapalı sonuçları aynı olmalı.
2. Home/Live/Movies/Series menü geçişi, seçili/oynayan/focus ayrımı, safe-area/font ölçeği; modal açıldığında alttaki katalog input alamamalı.
3. Player panel Back→panel kapanır; controls Back→gizlenir; tekrar Back→Player çıkar. Kategori/kanal/scroll/focus restorasyonu ve hidden-focus loop ayrı gözlemlenir.
4. Telefon/tablet katalog→Player→Back ve orientation; tablet döndürmede scroll/selection; Preview sanal D-pad ve Film Info scope.
5. Xtream, M3U, Stalker için ayrı Live/VOD/episode resolver, switch, favori/history/resume/cache senaryoları; TMDB ID playback kimliği olmaz.

Her gerçek kabul kaydı cihaz/OS, APK/run, exact SHA, adımlar, gözlenen sonuç ve kanıt bağlantısı içermeli. Veri yoksa PASS yerine NOT TESTED veya BLOCKED yazılır. Bu belge fiziksel teste geçiş onayı değildir.

## U2 otomatik kabul eki — fiziksel aşama başlamadı

1. `computePosterGridLayout` üç üretim katalog yoluna bağlanır; provider/category/search/sort scope'u anchor'ı ayırır; aynı ID yeni sütun row'una taşınır. Native yol mevcut hook'a delegedir.
2. Home'un image/empty/loading durumları aynı responsive yüksekliği kullanır. Ölçülen scroll viewport ve carousel genişliği orientation sonrası yenilenir; seçili Hero ID'si korunur. Preview autoplay odağı değiştirmez.
3. `u2ResponsiveScenarios`: grid/Hero ölçü matrisi, stable ID row eşlemesi, Preview görünür/scope kontrollü restore ve stale async sonuç iptali. Bu model testi fiziksel PASS değildir.
4. `u2CatalogHookScenarios`: üretim hook'unun state/ref yaşamı ve layout/viewability callback'leri host adapter ile çalıştırılır; Android FlatList implementasyonu çalıştırılmaz.
5. `nativeTvHomeRenderScenarios`: mevcut 33 Native TV host render korunur; telefon/tablet P/L ve Preview için ek 30 render ile yüklenmiş/boş/loading yükseklik eşitliği doğrulanır. Gerçek Yoga/font/overscan/firmware kabulü değildir.
6. Mevcut provider, Player/Back, orientation, Native JVM Focus, Elite Live, Film Info ve TMDB güvenlik testleri kaldırılmaz. Quality'ye iki U2 kapısı eklenmiştir; exact-HEAD checkout kuralı aynıdır. APK workflow'ları değiştirilmez.
7. Yeni HEAD için yalnız kendi `Quality` run'ı ve `QUALITY_EXACT_HEAD` satırı kabul edilir. Son yayın SHA/run bağlantıları PR #143'ün Checks ve açıklamasında tutulur; belge kendi commit SHA'sını uydurmaz.

Fiziksel matrisin bütün güncel birleşik kaynak hücreleri NOT TESTED / DEFERRED_RC kalır. Eski Homatics FAIL, TMDB LIVE BLOCKED ve legacy 14 SKIP kayıtları U2 otomatik başarılarıyla değişmez.

## U3 otomatik kabul sözleşmesi

- #130 kaynak testi 19 senaryo korunur; ek performans lifecycle/privacy/bounds testi deneme korelasyonu, duplicate/missing olaylar, timeout ve retention sınırlarını sınar.
- Cache policy testi 24/72 saat, otomatik açık/kapalı, cache yok/mevcut, clock rollback ve eski v1 tercih davranışını korur. Geçersiz/eksik tercih sürümü güvenli v1 varsayılanına döner; katalog dosyası sıfırlanmaz.
- Üretim CatalogSyncProvider host effect testi: warm cache, single-flight, başarı/hata, provider switch, geç timestamp, eski timer callback, expiry ve otomatik kapatma. Gerçek React Native scheduling testi değildir.
- Üretim catalogCache gerçek host SQLite testi: cold/legacy NULL timestamps, transaction rollback, başarılı swap, failed-refresh cache retention, provider isolation ve credential-free DTO. Android Expo SQLite/firmware kabulü değildir.
- Refresh window ve ownership completion testi: yüklü pencere/ID korunması, iptal, offline, ilerlemeyen cursor, eski policy ve release sırası. Scroll piksel/Android Focus fiziksel kanıtı değildir.
- Mevcut U2, Native JVM Focus/stability/reachability, Preview D-pad, Player/Back, orientation, provider/identity, Elite Live/Film Info ve TMDB güvenlik kapıları çalışır; test silme/skip yoktur.
- Final otomatik kabul yalnız final HEAD'i checkout eden push ve PR Quality ile verilir; `QUALITY_EXACT_HEAD` eşitliği şarttır. Eski U2 run'ları U3 için PASS değildir. Son SHA/run bağlantıları PR #143 açıklaması/Checks içinde tutulur.

Tanılama yalnız güvenli alanları tutar; olaylar diske yazılmaz. Fiziksel performans kazancı veya hız yüzdesi ölçülmedi. APK/fiziksel test yoktur; Native TV FAIL, TMDB LIVE BLOCKED ve RC onay politikası aynıdır.

## U4.1 otomatik kapsam ve RC borcu

`u4HomeMovieInfoScenarios.mjs` gerçek production hook'unu host üzerinden çalıştırır: seçim oynatmaz, provider kimliği korunur, güncel snapshot kullanılır, kaldırılmış içerik/provider switch/eski callback engellenir, çift Play tek başlatmaya iner, modal kapatma oynatmaz. Shell ve mevcut modal bağlantısı kaynak sözleşmesiyle ayrıca kontrol edilir. Bunlar Android event dispatch veya fiziksel cihaz testi değildir.

Bu dilimin CI kabulü yalnız yeni final HEAD'deki exact-SHA Quality ile yapılır; U3 `3eb8b55230b77e26e7f634be88aafbaefa3d6a1e` yeşili yeni değişikliğe devredilmez. Mevcut responsive, Hero/Native Focus, Player/Back, provider, TMDB ve U3 cache/performance kapıları tutulur. Yeni U4 host test ve biçim kontrolü mevcut Quality'ye eklenir; APK tetikleyicileri değiştirilmez.

RC'de daha sonra kullanıcı onayıyla: Home Hero/raf seçimi → Info → Geri aynı konum/odak; Info → İzle → Player panelleri/kontrolleri → çıkış Home; orientation; provider değişimi; refresh sırasında kaldırılan film; TV Preview scope ve Native D-pad. Stalker ve Series Info eksikleri çözülmeden bütün action parity kabulü verilemez.

## U4.2 kabul sözleşmesi

Otomatik kapsam: production controller + gerçek VOD normalizer/resolver ile mock provider; production hook + ortak MovieInfoModal host render + gerçek JS Preview focus controller. Aynı başlık/farklı portal ID, Info'da sıfır provider/create_link isteği, güncel command, tek Play, provider/runtime session değişimi, iptal edilmiş geç yanıt, kaldırılmış içerik, retry, secret içermeyen hata, eski v1 summary/locator, metadata failure/local fallback, modal Back/ilk hedef/Preview restorasyonu ve kökene göre Home/Movies dönüş bağlantıları kapsanır. Önceki testlerden yalnız Home preview writer kaynak assertion'ı yeni locator argümanını da doğrulayacak şekilde güçlendirildi; test kaldırılmadı.

Mevcut U2/U3/Native JVM/Preview/Player-Back-orientation/provider/TMDB/Elite kapıları korunur. Final kod+docs HEAD'inin push ve PR Quality loglarında exact checkout SHA'sı karşılaştırılır. Host testi Native Android firmware/layout veya fiziksel PASS değildir. APK tetikleyicileri ve Quality izinleri değiştirilmez.

RC borcu: her profil için Hero/raf → Info → Back aynı kart/konum; Info→İzle→Player Back sırası→Home; Movies→Info→Player→Movies; modal üst katman sahipliği; runtime session/provider değişimi; aynı başlıklı film; offline/bulunamayan film ve tekrar deneme; orientation. Bu görevde APK/fiziksel test yapılmaz.

U4.3 çıkış ölçütü: Home ve katalogda exact provider+series ID ile ortak yerel Info; seçili season ID + episode ID'nin korunması; mevcut Stalker targeted hierarchy / Xtream / M3U yollarına ayrı ve güncel playback handoff; Home/Series dönüş kökeni ve seçimin korunması; stale provider/session ve çift eylem testleri; metadata yokken çalışabilme; final exact-SHA Quality. Tam U4/ürün kabulü bundan ayrı kalır.

U4.2 regresyon uyarlaması: üç eski kaynak assertion'ı yeni sözleşmeyi doğrular: Home preview locator çağrısı; Movies varsayılan dönüşü + Home override + aynı player handoff; history/progressRef ile origin-aware Movies dönüşü. Senaryolar kaldırılmadı, provider/secret kontrolleri gevşetilmedi. İlk yerel turda bunlardan biri eski sabit Movies imzasını beklediği için başarısız oldu; sözleşme güçlendirilip ilgili suite yeniden çalıştırılır. Geçici pnpm10 önbelleği eksikliği restore edildi; redaksiyon kapısı da yeniden çalıştırılır.

## U4.3 otomatik ve fiziksel kabul sınırı

Yeni host/model/service kapısı production paged flow/hook, gerçek StalkerSeriesProductSurface ve mevcut Stalker hierarchy normalizer/resolver, ortak SeriesInfoModal ve gerçek JS Preview controller'ı çalıştırır. Aynı başlıklı diziler/opaque ID, farklı provider'da aynı ID, sezon/bölüm sırası, eksik metadata, boş sezon/grup, loading/error/retry, provider/session değişiminde geç yanıt ve cache publication, hızlı seçim, çift bölüm, eski callback, explicit progressRef ve kaynak dönüşleri kapsanır. Bilgi/season açılışında playback/create_link yoktur. Tüm U2/U3/U4.1/U4.2/Native/Preview/Player/TMDB kapıları korunur.

Golden inline detay ortak modala taşındığından eski source guard'lar yeni production dosyasını da okur. Seçim generation sayacı yerine request AbortController+opaque ticket guard'ı doğrulanır. Eski Back helper API testi tarihsel kalır; yeni runtime Back doğrudan onClose/source üzerinden ayrıca davranış testindedir. Test senaryoları kaldırılmaz veya skip edilmez.

Final kod+docs HEAD için iki Quality run ve logdaki QUALITY_EXACT_HEAD birlikte doğrulanır. APK/fiziksel test yok. RC'de: her desteklenen provider/profil için Home/katalog→seçilen dizi→sezon/bölüm→Player→aynı detay→kaynak kart; modal arka input izolasyonu; focus/selected ayrımı; orientation ve provider/session iptali. Fiziksel PASS yalnız gerçek cihaz kanıtıyla.


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

RC kapısı açık: Homatics gerçek D-pad ile -10/+15, pause, panel/Back, hata retry/çıkış; Poco dokunma zaman çizgisi ve orientation; tablet ve Preview bağımsız kabul. Bu görev fiziksel test başlatmaz. Bilinen süre sarılabilirlik için mevcut ürün kapısıdır; her medya akışının gerçekten seek desteklediği iddia edilmez.

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

## U4.3 Home/Movies/Live restoration closure follow-up — 2026-10-19

- **Start gate:** PR #143 OPEN/DRAFT, base `feature/r19-tmdb-secure-proxy`, başlangıç SHA `58d04dfec138d8953976b04974f696d26c6d677d`, Quality #1443 SUCCESS. Eşzamanlı U4.1/U4.2/Series, modal ve provider-scoped Native Focus mimarisi korunur.
- **IMPLEMENTED, scoped:** `components/catalog/PagedCatalogViews.tsx` Movies Info seçimini provider ID ile sınırlar; aynı provider'da katalog revision değişip aynı film kalırsa güncel item ve yeni modal callback'iyle devam eder; eski Play/Close callback'lerini reddeder; kaldırılmış veya farklı provider'daki seçimi geçersizleştirir. Katalogdaki geçerli kart için scroll anchor korunur. `components/elite/EliteLiveCatalog.tsx` güncel revision + kanal identity/index ile eski Focus/OK callback'lerini geçersizleştirir; silinen kanal yerine ilk monte edilmiş kanal için Focus fallback işareti sunar, otomatik oynatma başlatmaz. `components/catalog/PagedCatalogViews.tsx` gerçek katalog revision'ını Live adapter'a iletir.
- **SOURCE/HOST PASS, scoped:** `tests/p1CatalogProductionHostScenarios.mjs`: 8 cihaz profilinde gerçek Movies/Series render + Info, güncel revision, eski provider ve modal aksiyon guard'ı, arama/kategori callback'leri, silinmiş film, grid restorasyonu. `tests/u41StageRailLiveHostScenarios.mjs`: gerçek Live/Nav render'da 720×480 ve 1920×1080 TV, arama aç/kapat, kategori, eski revision kanal callback iptali, ilk geçerli kanal fallback ve OK playback ayrımı; mobil/Preview rota. `tests/u42HomeCollapsibleHostScenarios.mjs`: gerçek Home Hero/raf kartı Info/Watch onPress bağlantıları, katlanma ve kimlik. Existing U4 Home Movie Info hook+modal, Series, Player/Back, Native Focus/Preview ve provider regresyonları Quality'de korundu. Kod SHA `a5f5fd9f1dc42f8228048da8bb285a68defdf78e`, Quality #1479 run `39214558707`: SUCCESS (P1, U4.1, U4.2 host ve typecheck dâhil).
- **PARTIAL / open SOURCE/HOST acceptance:** Home raf→Info→Back ve Player→Home, Movies Info→Player→Back, Live kanal→Player→Live, ardışık Back ve StageRail→içerik→StageRail dönüşlerinin tümünü *tek gerçek üretim shell/player render oturumunda* uçtan uca doğrulayan birleşik host kabulü henüz yok. Mevcut host senaryoları birbirini tamamlar, ancak fiziksel Native Android odak hareketini veya bu tam birleşik kabulü kanıtlamaz. U4.3 bütününün SOURCE/HOST kapanışı bu eksikler giderilmeden PASS değildir. U4.4 unified search/zapping DEFERRED; geçiş kapısı PARTIAL.
- **Mevcut owner:** `modules/legendstream-tv-remote/android/.../LegendStreamTvRemoteModule.kt` yalnız bağlı/görünür hedefi Focus'a alır; geçersiz scope/oturum ve kaldırılan hedefte pending restoration iptal edilir, modal onShow/mount olayları üzerinden sınırlı iş planlanır. İkinci Focus manager eklenmedi. Android FocusFinder/P-DPad/TV Box fiziksel kabulü `PHYSICAL_PENDING_RC / DEFERRED_RC`; önceki Native TV Physical FAIL, TMDB LIVE BLOCKED ve legacy cleanup 14 SKIP aynen açık. Quality otomatik PASS fiziksel PASS sayılmaz.
- Beş kaydın bu tek commit'te güncellenmesi son exact-SHA Quality doğrulamasını zorunlu kılar. Yeni PR/branch, merge, APK, fiziksel test, player engine veya resolver değişikliği yapılmadı.


## U4.3 cross-device Physical FAIL repair — 2026-10-19

Başlangıç: `cfbc926e4de2f3e587bfe612f41c5f587a1b408c`; PR #143 OPEN/DRAFT,
base `feature/r19-tmdb-secure-proxy`; başlangıç exact-SHA Quality #1481 SUCCESS.
Üretim düzeltmesi: `eeb175d52debfed680138f00b9619e4326f751dc`; bu kayıt commit'i
native hedef kimliği bildirimini yalnız küçük menüye sınırlar (tüm kartları her tuşta
render etmez). Önceki U4.1/U4.2/U4.3 ve eşzamanlı kaynak korunur.

**SOURCE/HOST PASS (bu düzeltme kapsamı); PHYSICAL PENDING.** Homatics 4K V2 ve
Poco X7 Pro Android 16 kullanıcı tekrar testi yapılmadı. Tarihsel **Native TV Physical FAIL**,
**TMDB LIVE BLOCKED**, **legacy 14 SKIP / 0 DELETED** kayıtları kapanmaz.
U4.3'ün bütün birleşik shell/Player fiziksel kabulü veya U4.4 geçişi PASS ilan edilmez.

Kaynak kanıtı: `ResponsiveContentNav.tsx` dikey `flexDirection: column` üretirken
`TvFocusPolicy.java` eski yatay menü için UP'ı sınır, DOWN'ı içerik geçişi kabul ediyor,
yatay menü hareketinde içerik hedeflerini eliyordu. Gerçek render geometrisini Java
üretim politikasına veren test bu uyumsuzluğu kapsar. Ayrıca `FocusButton` React
onFocus/onBlur ile native focus subscription üzerinden aynı menü state'ini iki kez
bildiriyordu. Native TV'de tek yetkili bildirim artık `useNativeTvTarget` native hedef
kimliğidir; geç gelen React focus/blur menüyü açamaz. Blur ardından başka menü öğesine
geçiş menüyü geçici kapatmaz. Native policy ölçülen dikey/yatay menüyü ayırır;
dikey UP/DOWN menü içinde, RIGHT içerikte en yakın satıra veya geçerli son hedefe gider.
Native BACK menüde RIGHT dönüşünü kullanır, basılı BACK repeat ikinci navigasyon yapmaz.
Son içerik hedefi kayıtlı/bağlı/görünür/scope uyumlu olmalı; unregister ve catalog root
(provider yaşam döngüsü) değişimi bu referansı siler. Player/modal BACK sözleşmesi korunur.

Telefon yoğunluğu: `catalogGridLayout.ts` portrait telefon için kullanılabilir genişlik
ve fontScale ile en çok 3 sütun seçer; TV/Preview/tablet ve landscape politikası korunur.
393×873, sol/sağ safe-area 12 dp host girdisinde sütun 2→3, poster genişliği
154.5→99 dp, 2:3 poster yüksekliği 231.75→148.5 dp. 320×740 aynı inset ile 1→2
(248→118 dp); 393 dp fontScale=2 için 1→2 (321→154.5 dp). 873×393 landscape 5→5,
800×1280 tablet 3→3; 1920×1080 TV 5→5. Bunlar üretim geometri fonksiyonu ölçüleridir,
Android ekran görüntüsü/gerçek cihaz ölçümü değildir. Telefon katalog başlığı 28→18 sp,
poster başlığı en çok 14 sp/2 satır; kart title padding 9→4 dp, fontScale yüksekliği korunur.
Arama/sıralama/yenileme kontrolleri aynı kompakt satırı paylaşır, dokunma hedefleri 48 dp;
üst navigasyondaki yinelenen katalog adı/Canlı ara girişi kataloglarda kaldırılır.
Stalker Movies ve Live de telefon yoğunluk kurallarını uygular; search/resolver/cache
kapsamı değişmez. Kaynak/ayar ve katalog içi arama erişimi korunur.

Otomatik kanıt: StageRail/Elite Live 6/6 profil (gerçek render + Java policy;
UP/DOWN/RIGHT/LEFT, Hero→raf, hızlı focus bildirimleri), gerçek FocusButton + native hook
9/9, Movies/Series 10/10 profil, Stalker Movies 10/10, Stalker Live 4/4.
Series 40/40, Collapsible Home 12/12, visible Home/Player 18/18, P0 18/18,
U2 grid hook 10/10, Preview 32/32, Native remote 27/27, JVM focus 66/66,
stability 21/21, Home reachability 93/93, responsive JVM 240/240 yerelde geçti.
TypeScript ve yeni/değişen formatlanmış Focus/Nav/grid/test dosyalarının Prettier
kontrolü geçti; mevcut legacy dosyaların ilgisiz biçimi/statik sözleşmeleri korunur.
Yeni ownership host ve biçimlendirme kapıları mevcut Quality workflow'una eklendi.
Assertion silinmedi/gevşetilmedi, skip eklenmedi.

Gecikme sınırı: render hedefleriyle Java policy host ölçümü 5000 örnekte medyan
0.00051–0.00054 ms, p95 0.00134–0.00136 ms (tek yerel koşu, cihaz gecikmesi değil).
Mevcut isteğe bağlı, 20 kayıtla sınırlı ve kimlikleri arındıran inspector'a
`dispatchDurationMs` eklendi; Homatics native dispatch/JS/çizim gecikmesi henüz ölçülmedi.
Uçtan uca performans iyileşmesi iddia edilmez.

Home Hero kaynağı sağlayıcı movie/series kataloğudur (`HomeDiscovery.heroItems`).
Film Info `movieInfoModel` yerel başlık/poster/özet alanlarını önceler, TMDB eksikleri
zenginleştirir. TMDB canlı erişimi açılmadı; Hero veri modeli değiştirilmedi.

Son commit için exact-SHA Quality ve ardından aynı SHA Universal APK doğrulaması
teslim raporunda run/artifact kimlikleriyle kaydedilecektir. Bu kayıt oluştuğu anda
final CI/BUILD henüz doğrulanmadığından bu belge BUILD PASS iddiası içermez.
APK/Quality sonucu fiziksel PASS değildir. Yeni branch/PR, merge, force-push,
Player engine/resolver değişikliği ve U4.4 geliştirmesi yok.

RC adımları: Home LEFT→menü, UP/DOWN dört bölüm, RIGHT/BACK son içerik; hızlı LEFT/RIGHT ve basılı BACK; Hero→raf; her katalog→Info/Player→Back; provider değişimi. Poco: portrait/landscape, büyük yazı, arama/sırala/yenile, uzun başlık/eksik poster ve dönüş anchor. Kullanıcı onayı olmadan PHYSICAL PASS yok.


## U4.3 referans güdümlü Native Focus onarımı — 19 Ekim 2026

**SOURCE VERIFIED / IMPLEMENTED / SOURCE-HOST PASS; PHYSICAL_PENDING_RC.**
Başlangıç `48565355c809932f75a6d83411f460848650ee6d` (Quality #1491 SUCCESS); üretim onarımı `6216838f4a76d923b0419077d0ecd47f9b0dcc04`. [Sabit SHA referansları, kısa satır kanıtları, dosya eşleştirmesi ve test sınırları](U43_NATIVE_FOCUS_REFERENCE_REPAIR_TR.md).

- Rail artık bir native bölge aboneliği kullanır. Öğeler arası hareket genişlik state'ini tekrar değiştirmez; odak hedeflerinin boyutları sabittir, yalnız etiket/arka plan açılır. FocusButton callback kimliği yeni Focus bildirimi üretmez.
- Kanıtlanan LEFT komşu hatası: aynı fixture'da eski policy ikinci raf kartından menüye giderken yeni policy soldaki karta gider. Rail BACK'in React üzerinden ikinci route sahibi kaldırıldı; mevcut Native Window sahibi korunur.
- Gerçek host: StageRail/Live 6/6, FocusButton/hook 9/9, P0 18/18, Home/Player 18/18, katlanan Hero 12/12, Series 40/40; mobil P1 Golden/Series 10, Stalker Movies 10, Live 4 profil PASS. JVM policy 66/66, stability 21/21, reachability 93/93; responsive JS ve JVM ayrı ayrı 240/240. Typecheck ve hedefli biçim kontrolü PASS.
- Tek girişte tam bir rail-state geçişi; nav içi/tekrar/boş olayda sıfır ek geçiş; unmount sonrası eski callback reddi test edildi. Aynı provider session/revision, provider root ve Player/modal korumaları yeniden yazılmadı; mevcut regresyonlar korunur. Tam native Window–React bridge–cihaz matrisi PARTIAL.
- Fiziksel dispatch/FocusFinder gecikmesi ölçülmedi; performans iyileşmesi iddiası yok. Mevcut gizlilik güvenli inspector'a sınırlı rail-state kaydı eklendi. Referans framework veya GPL kaynak kodu taşınmadı.
- Bu kayıt commit'i dahil final remote SHA için Quality zorunludur; bu metin gelecekteki run sonucunu PASS varsaymaz. Exact-SHA SUCCESS ardından aynı SHA Universal APK üretimi ve artifact doğrulaması teslim raporunda gösterilecektir. APK fiziksel PASS sayılmaz.

Homatics LEFT/UP/DOWN/RIGHT/OK/BACK, uzun basış, hızlı karşı yön, ekran/modal/provider/session geçişi ve Player hata/Back RC kabulü açık. Mobil üretim yoğunluk dosyaları değiştirilmedi; Poco cihaz regresyonu fiziksel bekler. Tarihsel **Native TV Physical FAIL**, **TMDB LIVE BLOCKED**, **legacy 14 SKIP / 0 DELETED** korunur. PR #143 OPEN/DRAFT, base değişmedi; merge/yeni branch/yeni PR yok. U4.4 DEFERRED; başlanmadı.
