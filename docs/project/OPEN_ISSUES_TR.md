# Açık İş ve Kusur Defteri

Durumlar: OPEN, SOURCE_INTEGRATED, AUTO_VERIFIED, DEFERRED_RC, BLOCKED. Fiziksel durumlar PASS/FAIL/NOT TESTED/BLOCKED/PARTIAL ayrıca tutulur. Yeni kullanıcı kusuru mevcut kayıtla ilişkilendirilir; ciddi teknik zorunluluk yoksa entegrasyon sırasını bozmaz.

| ID / öncelik | Ekran ve cihaz | Kaynak/kanıt | Geliştirme / fiziksel durum | Sonraki eylem / sorumlu |
|---|---|---|---|---|
| TV-001 / P0 | Homatics 4K V2: focus/selected görünürlüğü, Player kontrolleri ve çıkış | #135 Universal APK #487 kullanıcı bulgusu; bu ilk bulgu için exact build SHA burada yeniden kanıtlanmadı | Tarihsel Physical FAIL açık; kaynak onarımları #136–#138 üzerinden U1'de, güncel kaynak fiziksel NOT TESTED | RC'de aynı Player/Back ve katalog dönüş senaryosu; Native input hattı |
| TV-002 / P0 | Homatics: Home/DOWN/raflar ve kumanda kararlılığı | Eski APK #504 kullanıcı bulgusu; exact test SHA bu kayıtla doğrulanmış sayılmaz. #138 kaynak 7591b3c; docs/tv/PR138_P0_FOCUS_REPAIR_TR.md | Physical FAIL devam; üç source fix U1.1'de, yeni cihaz kanıtı yok | U1 otomatik policy/render; fiziksel retest yalnız RC onayıyla |
| TV-003 / P1 | Home Hero yüksekliği / ilk raf | nativeTvHomeLayout + HomeDiscovery; docs/tv/PR138_HOME_COMPACT_REACHABILITY_TR.md | SOURCE_INTEGRATED; geometri/JVM/render testleri; gerçek Android NOT TESTED | Extreme font/safe-area ve görünür hedef kabulü RC'de |
| UI-001 / P1 | Telefon landscape katalog policy | #128/#129 device/presentation politikası; usePlayerOrientation | OPEN; #123'ün Poco 13/13 PASS'i yeni policy'ye devredilmez | #124/#133 ile ürün davranışını uzlaştır; ortak sunum hattı |
| UI-002 / P1 | Mobil/tablet/Preview grid ve Home | #121/#122/#126/#127 ayrı kollar | OPEN / NOT TESTED | Eski tüm dosyaları kopyalamadan helper→ekran bağlantısını birleştir |
| UI-003 / P1 | Tablet rotation/scroll | Grid column key/remount davranışı | Kaynak riski; fiziksel FAIL diye etiketlenmedi; NOT TESTED | Scroll/selection restorasyon sözleşmesi + otomatik davranış testi |
| ELITE-001 / P1 | Home/Live/Player/overlay bütün cihazlar | #139: gerçek Elite Live yalnız Native TV; showcase üretim Home/Player değil | PARTIAL / NOT TESTED | Ortak marka ve action modeli; cihazlara uygun yerleşim |
| INFO-001 / P1 | Home→Film Info, Series Info | #141 katalog modalı var; Home film yolları farklı; Series metadata ekranı yok | OPEN / NOT TESTED | Resolver'a dokunmadan detail action parity |
| TMDB-001 / P1 | Metadata live bütün cihazlar | #140–#142 mock matcher/cache/proxy; gerçek deployment/session/secret kanıtı yok | **TMDB LIVE BLOCKED** | Hosting kullanıcı seçimi/onayı, HTTPS + trusted issuer + server token + atıf. Netlify kullanılmaz; sunucu dağıtılmaz |
| PERF-001 / P1 | Startup/playback ölçüm | #130 ayrı branch | OUTSIDE_U1_1 / NOT TESTED | Gözlem callback ve redaksiyon entegrasyonu |
| CACHE-001 / P1 | Refresh/provider switch | #131 ayrı branch | OUTSIDE_U1_1 / NOT TESTED | Üç provider için cache/cancel/stale testleri |
| HYGIENE-001 / P2 | Araç zinciri/API/ek CI | #120 | Yalnız scripts root typecheck TS18003 onarımı alındı; PR bütünü OPEN | Kalan #120 semantik uzlaşması; tam PR tamamlandı sayılmaz |
| LEGACY-001 / P2 | 14 onaylı eski branch | 17 Ekim legacy temizliği: **0 DELETED / 14 SKIP / 0 FAILED**; deployment/environment okunamadı ve ref-delete kabiliyeti yok | SKIP / RETAIN; yönetim borcu | Erişim geldiğinde exact-ref ve dependency gate'i yeniden yap; U1'i durdurmaz |
| ADMIN-001 / P1 | GitHub yönetim koruması | Son okuma main ve 14 stacked parent protection yok; rulesets=[] | BLOCKED; auto-merge/delete kapalı | Yetkili settings erişimiyle koruma ve required typecheck kaynak doğrulaması; hiçbir bypass yok |

## Legacy SKIP kapsamı — kaybolmayacak liste

`diag/r18-e0p-stalker-epg-probe`, `feat/epg-stream-info`, `feat/premium-player-chrome`, `feat/r18-ui-presentation-foundation`, `feat/stalker-live-catalog-parity`, `feat/stalker-live-parity-current-main`, `fix/large-xtream-anr`, `fix/large-xtream-epg-memory`, `fix/large-xtream-oom-hardening`, `fix/player-controls-regression`, `fix/release-vlc-patch`, `fix/stalker-product-parity-d12-v2`, `fix/stalker-product-parity-d12`, `fix/xtream-real-login`.

Bu U1 görevi branch silme, mevcut PR merge/close/Ready/retarget veya otomatik merge yetkisi vermez. Tarihsel fiziksel senaryoların adımları docs/tv belgelerinde korunmuştur; oradaki APK hazırlık adımları bu aşamada yürütülmez.
