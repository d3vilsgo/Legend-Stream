# Geliştirme, Quality ve Release Kabulü

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
