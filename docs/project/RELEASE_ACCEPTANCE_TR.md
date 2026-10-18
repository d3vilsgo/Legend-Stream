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
