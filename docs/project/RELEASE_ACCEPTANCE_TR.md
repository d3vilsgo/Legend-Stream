# Geliştirme, Quality ve Release Kabulü

## Geçerli politika

**Quality PASS = exact HEAD üzerinde otomatik doğrulama. Physical PASS = ilgili cihazdaki gerçek kabul kanıtı.** Birbirinin yerine geçmez. Kaynak veya metadata sağlayıcısı destek bayrağı runtime kabulü sayılmaz.

U1.1 kaynak birleştirmesidir. Fiziksel testler GLOBAL INTEGRATION & FEATURE COMPLETION boyunca bilinçli ertelenmiştir. Her push/PR için Universal APK yoktur. Bütünleşik RC hazır olmadan ve kullanıcı onayı alınmadan APK/fiziksel kabul başlamaz.

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
