# U1 Entegrasyon Defteri

Son geometri kontrolü: Native Hero pager köşeden eylem satırına taşındı; Watch→Info→pager LEFT/RIGHT ve Hero↔ilk raf için beş yeni üretim-policy JVM senaryosu eklendi. Aşırı font ölçeğinde ikincil eyebrow yalnız başlığa yeterli yükseklik varsa gösterilir. Fiziksel kabul iddiası değildir.

## Visible Home & TV Remote Repair — 18 Ekim 2026

Remote gate: PR #143 OPEN/DRAFT; branch integration/legendstream-u1; başlangıç `ed94a373ce64ff1a006c27b712b731a8ed1eda3e`; base feature/r19-tmdb-secure-proxy. Quality #1265/#1266 SUCCESS aynı SHA. Mevcut Universal APK #506 (39131986336) SUCCESS aynı SHA. Videolarda build kimliği bulunmadığından fiziksel kaydı SHA'ya kesin bağlama yok.

1. `7a3fee9ba49a71e9b6019accde73a65c85ee0948` — Dialog onShow'da native target/window yenileme, scope/currentFocus ayrımı, frame post ile mevcut ticket kontrollü restore; zaman gecikmesine dayalı loop yok. Player-error retry/exit, hata Back, panel başlığı/72dp row offset ayrımı, TV clipping, etiket wrap. Native dedupe DOWN/UP/repeat üretim TvFocusStability kapıları korunur. Inspector tanı/overlay erişimi korunur.
2. `f01eb07888d5a2432b0ff2efebdddc2f566a279f` — mevcut production HomeDiscovery featured tasarım, görseli olmayan katalog öğesini de okunur fallback ile kabul; film/dizi nesnesi mevcut Info handler'a gider. Home İzle ve Bilgi güvenli Info girişini paylaşır; gerçek playback yalnız mevcut Info/episode eylemiyle. Mobilden bölüm dropdown kaldırıldı; beşli in-flow alt bar ve mevcut library yolları. Search kısayolu Live arama yüzeyine gider. Kategori arama alt paneli kimlik/sıra/paging değiştirmez. Preview dock ayrı alan, modal kendi dock'u ve viewport owner stack; sezon viewport restorasyonu.
3. Bu belge commit'i — beş proje kaydı, fiziksel bulgular, sınırlar ve kabul matrisi. Final exact-SHA CI PR Checks'ten ayrıca doğrulanır. İki kaynak commit'inin dosya ağaçları yerel test edilen tree ile byte-identical doğrulandı; yalnız integration ref fast-forward güncellenir.

Yerel son tur: **77/77** Quality komutu PASS; typecheck mobile/API/workspace, U2/U3/provider/cache, Native policy, Preview, Film Info/Series ve TMDB güvenliği korunur. Yeni host **10/10**, Home **33+30**, U4.2 host **13/13**, U4.3 **31/31**. Eski menü/floating dock ve birebir format assertion'ları yeni ürün sözleşmesine göre güncellendi; test silinmedi/skip eklenmedi. Category label filtering ayrı presentation helper'a taşındı; katalog repository/persistence/resolver değişmedi.

Somut sınırlar: Native Android Kotlin/Window fiziksel çalışması yerelde derlenmedi; JVM/host PASS fiziksel PASS değil. Chromium indirmesi geçerli arşiv vermedi; gerçek runtime screenshot yok. Web önizleme yalnız izole production-component/örnek katalog incelemesidir; uygulama görüntüsü sayılmaz. Kategori Modal Preview dock parity açık. Tablet yatay kompakt bar var, ayrı dikey rail yok. Live yayın başarısızlığı nedeni video genel mesajından çözülemez. Tam Elite Live/Player ve TMDB dizi servisi tamamlanmadı.

Native TV tarihsel FAIL, güncel fiziksel NOT TESTED/RETEST_REQUIRED; TMDB LIVE BLOCKED; legacy **14 SKIP / 0 DELETED** aynen korunur. Main/base/diğer PR kaynakları değişmez; merge/Ready/close/rebase/force-push/branch deletion/deployment yapılmaz. APK yalnız mevcut workflow_dispatch kabiliyeti varsa final Quality sonrası denenir.

---

## U1.1 kaynak gate — 17 Ekim 2026

| Kaynak | Doğrulanan SHA | Karar |
|---|---|---|
| main | `810adc2f7e82da52d8dd6768fcd5cf1d3040e106` | Değiştirilmedi |
| #138 HEAD | `7591b3ce5d9d5903714749f51ba74ebb48bb3b24` | Yalnız eksik üç commit alınır |
| #142 HEAD | `98423240d1f966388e74aa4249632b1c921b3c4b` | Yeni integration/legendstream-u1 başlangıcı |
| #138/#142 merge-base | `3755a39b48441fd0904d3a40a7a8c77576ee0281` | #142..#138 tam olarak aşağıdaki üç commit |

Branch remote'da yoktu; exact #142 SHA'sından oluşturuldu. Mevcut branch üzerine yazılmadı. Yerel izolasyon ayrı worktree ile yapıldı.

| Sıra | Kaynak commit | Davranış | Çözüm |
|---|---|---|---|
| 1 | `207a78af3603d96436623b23319f69bfc5d59757` | Native row/kolon hareketi, sabit focus border, modal/window input sahipliği, Inspector dispatch alanları | Ayrı `cherry-pick -x`; çatışma yok |
| 2 | `374f80d12264193396c9d6c22cdd76d2019d4068` | Home/Live/Movies/Series region izolasyonu; stale başka ekran hedeflerini eleme | Ayrı `cherry-pick -x`; çatışma yok |
| 3 | `7591b3ce5d9d5903714749f51ba74ebb48bb3b24` | Native Home viewport bütçesi, ilk raf önizleme, Hero/shelf focus ID, görünür hedef scroll davranışı | Ayrı `cherry-pick -x`; Quality.yml otomatik birleşti; hiçbir dosya üstten kopyalanmadı |

Bu üç logical commit'in kaynak mesajları ve `(cherry picked from commit ...)` izi korunur. U1'de eski SHA'ların aynı SHA ile ancestor olması beklenmez; yeni commit kimliği/cherry-pick ilişkisi Git geçmişinden okunur.

## CI ve entegrasyon regresyonu

Quality'ye U1 push/base kapsamı ve checkout sonrası exact SHA eşitliği eklendi. Permissions `contents: read` olarak kaldı. Mevcut Quality kapıları ve APK workflow'ları korunur; U1 için APK tetikleyicisi eklenmedi.

Production `TvFocusPolicy` JVM testine beş U1 sınır senaryosu eklendi: Elite Live'ın stale Home rafını seçmemesi; Film Info içi hareket; modal sınırından kataloğa kaçmama; alttaki Movies hedefinin modal sahipliği alamaması; content scope'ta Live hareketinin korunması. Bunlar Android Dialog'un gerçek event dispatch testi değildir.

Birleşik kaynak incelemesinde #139 Stalker Elite/legacy hedeflerinin `stalker-live:` prefiksinin #138'den taşınan `nativeTvRegion` içinde genel `content` değerine düştüğü saptandı. Regresyon testi önce `content != live` ile başarısız oldu; yalnız bu hedef prefiksi `live` bölgesine eklendi. Böylece var olan ekran izolasyonu bu hedeflere de uygulanır; Stalker resolver/transport/identity değiştirilmez. `nativeTvRemoteScenarios` artık 27 senaryo içerir. Bu, fiziksel olay davranışı için PASS değildir.

İzleme: [Draft PR #143](https://github.com/d3vilsgo/Legend-Stream/pull/143). İlk adayın 60 yerel shell Quality kapısında 17 adım standart girişle geçti; TSX CLI IPC ortam kısıtına takılan 43 kapı aynı test girişleriyle `node --import tsx` üzerinden geçti. Sonraki kaynak değişikliği için aynı HEAD'de yeni GitHub Quality sonucu zorunludur; eski run sonucu devredilmez.

Yerel tam workspace typecheck, mobil ve API'yi geçtikten sonra devralınan `scripts/tsconfig.json` içindeki var olmayan `src` girdisinde TS18003 verdi. #120 HEAD `faf0105a87633693161995b8801e0962d168f97c` içindeki yalnız bu küçük onarım seçilerek alındı: mevcut `check-console-usage.mjs` gerçek JS typecheck girdisi oldu; `allowJs/checkJs` açıldı. Bu config kaynakla birebir eşleştirildi; #120'nin geri kalanı entegre sayılmadı. Quality'ye mevcut kontroller kaldırılmadan tam workspace typecheck eklendi.

Normal Git push kimlik doğrulaması bulunmadığı için yayın, GitHub Git-data commit/ref araçlarıyla aynı dosya ağaçları ve kaynak izli mesajlar üzerinden yapılır. Sunucunun ürettiği commit SHA'ları yerel cherry-pick SHA'larından farklı olabilir; her remote tree kimliği yerel doğrulanan tree ile karşılaştırılır. Eski branch/ref geçmişi değiştirilmez, force-push yapılmaz.

Exact final SHA, Draft PR ve Quality run/check bilgileri bu branch'in GitHub geçmişi ve PR Checks kaydında tutulur. Kaynak dosyası kendi commit SHA'sını içeremeyeceği için sahte bir “final SHA” yazılmaz. Her yeni push, önceki yeşil run'ın kabulünü sıfırlar; `QUALITY_EXACT_HEAD` ve run `head_sha` eşitliği gerekir.

## PR hedef kararı

Yeni Draft PR'ın base'i **`feature/r19-tmdb-secure-proxy` (#142)** olur. #142 main'e göre açık stacked çalışmaları içeriyor; main hedefli yeni PR bunları ikinci paralel toplu merge yüzeyi yapardı. #142 base'i U1.1'in üç onarım + CI/test/proje kaydı farkını izole gösterir. Eski #135–#142 PR'larının base/head/durumları değiştirilmez. Bu yeni PR merge yetkisi değildir; bütün U1/main geçişi ayrı kaynak uzlaştırma dilimi ister.

## Koruma kanıtı

#142'nin EliteLiveCatalog, MovieInfoModal, TMDB matcher/cache/proxy ve provider resolver/identity kaynakları bu üç patch tarafından değiştirilmez. Player motoru/oturum çözümlemesi birleştirilmez. Değişen üretim dosyaları yalnız #138'den gelen Native Home, focus target/inspector ve native module davranışlarıdır; sonraki entegrasyon test ekleri ayrıca görünür.

## Açık kayıtlar ve teslim durumu

| Kayıt | Durum | Sonraki eylem |
|---|---|---|
| Üç #138 düzeltmesi | SOURCE_INTEGRATED | Exact-HEAD Quality; Physical NOT TESTED |
| Native TV tarihsel kusurlar | Physical FAIL korunur | Yalnız RC'de onaylı yeniden kabul |
| TMDB canlı | LIVE BLOCKED korunur | Onaylı hosting/issuer/token/atıf ve gerçek bağlantı |
| 14 legacy branch temizliği | 14 SKIP / 0 DELETED / 0 FAILED | Yönetim erişimi ve dependency gate bekler; U1'i bloke etmez |
| #120–#127 | Tam entegrasyon yapılmadı | PRODUCT_ROADMAP ve OPEN_ISSUES'taki ayrı kaynak işleri |
| #130/#131 | U1.1 dışında | Performance/cache semantik uzlaşması |
| U1 geneli | Tamamlanmadı | İlk dilimden sonra araç zinciri + mobil/tablet/Preview grid/Hero parity |

Geliştirme, otomatik doğrulama ve fiziksel kabul ayrı sütunlarla izlenir. Bu ilk kaynak diliminin başarılı olması bütün açık geliştirmelerin tamamlandığı anlamına gelmez.

## U2 responsive entegrasyonu — 17 Ekim 2026

Başlangıç PR #143 HEAD: `cd525af7cf1481d375e6e7abeaf808b290435f69`; base `feature/r19-tmdb-secure-proxy` / `98423240d1f966388e74aa4249632b1c921b3c4b`. Güncel main `810adc2f7e82da52d8dd6768fcd5cf1d3040e106`; değiştirilmez. Yalnız mevcut `integration/legendstream-u1` güncellenir; PR #143 Draft ve aynı base kalır. Ayrı detached worktree yerel izolasyondur; yeni remote feature branch/PR oluşturulmaz.

### Yeniden okunan remote kaynaklar

| PR | HEAD SHA | Gerçek base branch | U2 davranış kararı |
|---|---|---|---|
| #121 | `4b05e1645ea0fbd79620fbf68586267871639c22` | `main` | PARTIAL: grid + erişilebilir başlık alındı; header/detail farkı ertelendi |
| #126 | `104a40daef592580ef26a29974d951c7fe53a4cb` | `feature/premium-design-system-foundation` | INTEGRATED: üretim grid bağlantısı |
| #122 | `9353d8780b7d570a935f33241020f5ac1ffff507` | `main` | INTEGRATED: bounded Hero tüm durumlar |
| #127 | `cf42aa959fd1e587659f75891552a90a55102932` | `feature/premium-design-system-foundation` | INTEGRATED: premium Hero → gerçek Home |
| #124 | `576d930d38cef1368009bd5997702439a26aaf99` | `main` | ALREADY COVERED: evrilmiş #133 nav |
| #133 | `d0f57c5079783a1d4f887aef6aa1429d04dea1a1` | `feature/r18-premium-tablet-design-foundation` | ALREADY COVERED: U1 atası |
| #125 | `8eaca23b051adca4678a8bb0ecc4482e2b4a12a4` | `main` | PARTIAL: evrilmiş #132 token/metrics temeli |
| #132 | `138eba1b1e74d2f8bcaf933b6344ec4b81a0856e` | `feature/r18-presentation-foundation-1b` | ALREADY COVERED: U1 atası, tüketiciler U2 bağlandı |
| #138 | `7591b3ce5d9d5903714749f51ba74ebb48bb3b24` | `feature/r18-tv-remote-focus-inspector` | ALREADY COVERED: U1 kaynak izli üç onarım |

#132 ve #133 gerçek Git atalarıdır. #125/#126/#127 ve #124 ile U1 merge-base'i güncel main `810adc2…`; #121/#122 merge-base'i `e20d940e87705228a0822f87934d42758f3f7af2`; #138 merge-base'i `3755a39b48441fd0904d3a40a7a8c77576ee0281` (üç fix U1'de cherry-pick iziyle). PR başlıklarına bakarak özellik tekrar eklenmedi. Eski PR dosyaları topluca alınmadı; UI davranışları mevcut Film Info/Native scope sahiplerine semantik olarak bağlandı.

### Dosya → kanıt → etki → cihaz → kabul → eylem

| Dosya | Kanıt / değişiklik | Ürün etkisi ve kapsam | Kabul / sonraki eylem |
|---|---|---|---|
| `lib/catalogGridLayout.ts`, `hooks/useResponsiveCatalogGrid.ts` | Premium profil + gerçek list width + safe-area/fontScale; ID→row restore, provider/query scope iptali | Telefon/tablet/Preview responsive VOD/Series; Native mevcut hook'a delege | Model + host hook; gerçek Android scroll NOT TESTED |
| `components/catalog/PagedCatalogViews.tsx`, `components/stalker/StalkerGoldenMoviesCatalog.tsx`, `StalkerSeriesProductSurface.tsx` | Üç grid tüketicisi bağlı; GoldenSeries provider scope taşır; iki satır başlık fontScale ile yer ayırır | Üç provider aynı sunum sözleşmesi; Info/episode/resolver callback'leri korunur | Tam Quality; fiziksel katalog→Player→Back RC'de |
| `lib/homeHeroLayout.ts`, `components/home/HomeDiscovery.tsx`, iki Home shell | Premium bounded height + ölçülen viewport; loaded/empty/loading eşit; yatay/Preview raflar önce; seçili Hero stable ID | Telefon/tablet/Preview; Native #138 budget/input/focus grafiği korunur | Ek host render; Native 33 render ve JVM kapıları korunur |
| `lib/tvPreviewFocus.ts`, `components/tvPreview/TVPreviewFocus.tsx` | Restore yalnız kayıtlı, görünür, aktif scope hedefi; async revision guard | Preview sütun değişiminde modal arkasına kaçmaz | Controller ve hook testi; fiziksel Native PASS değil |
| `CompactLandscapeNavButton.tsx` | Mevcut Elite accent/selected semantic token + eliteVisual beyaz Focus | Telefon/tablet/Preview kompakt tab; aktif/focus/içerik seçimi ayrı | Tam Elite Home/Player/Live parity değildir |
| `.github/workflows/quality.yml` | İki U2 test kapısı eklendi; mevcut kapılar ve exact checkout korundu | Yeni HEAD'in gerçek otomatik doğrulaması | PR Checks + log SHA eşitliği gerekir; APK tetiklenmez |

Native `useNativeTvCatalogGrid`, `nativeTvHomeLayout`, `nativeTvResponsive`, production Java Focus policy/native input modülü; Player/orientation sahipleri; TMDB matcher/cache/proxy, MovieInfoModal, EliteLiveCatalog ve provider resolver kaynakları U1 başlangıcına göre değiştirilmez. StalkerSeriesProductSurface değişikliği yalnız `providerId` sunum scope prop'udur; playback mapping değişmez.

### Regresyon ve teslim kaydı

Yerel 62 Quality shell kapısının tamamı doğrulandı (katalog parity kapısı yeni source sözleşmeleri sonrası yeniden geçti). Yeni geometri/Preview controller 94 senaryo; üretim hook 9 senaryo; ek Home host render 30 senaryo. Mevcut Native Home host render 33 senaryo korunur. Tam Quality'nin kapıları test atlamadan çalıştırılır. Yerel TSX IPC kısıtı için sadece çalıştırıcıda `node --import tsx` kullanılır; CI'daki normal TSX girişleri değiştirilmez. Yerel pnpm 10 ve script binary PATH'i kullanılır; dependency/lockfile değişmez.

Eski Stalker boundary testinin width>=900 gibi sabit eşik zorlaması yeni ortak hook sözleşmesine güncellendi. Loading/disabled/provider-only dekorasyonun olmaması koşulları korunur; kart başlığı için fontScale minHeight artık açık bir erişilebilirlik koşuludur. Eski poster genişliği üst sınırı korunur; helper'da poster `columnWidth` ile toplam `cellWidth` ayrıldı. Bu testler kaldırılmadı.

Final SHA ve exact-SHA Quality bağlantısı PR #143'te sunulur. Bu dilim U1 ürün programını tamamlamaz. Sonraki dilim U3: #130/#131 performans/cache. Telefon katalog rotation politikası, #121 header/detail, tam Elite ekran parity, Home→Film Info/Series Info ve TMDB canlı işlerinin sahipliği roadmap'te açık kalır. Physical FAIL / NOT TESTED, TMDB LIVE BLOCKED ve 14 SKIP legacy kaydı aynen korunur.

U2 son tam regresyonunda eski EPG privacy testinin bütün trace metninde kısa `101` portal ID'sini aradığı, gerçek `at` zaman damgası `1792267910101` olduğunda yanlış FAIL verdiği görüldü. Üretim log/EPG kaynağı değiştirilmedi. Test, event+details payload'ının tamamında ID sızıntısını denetler; URL/MAC/title yokluğu denetimleri korunur. Aynı çakışan timestamp açık fixture olarak eklendi ve payload'ın değişmediği doğrulanır. Kontrol atlanmadı veya devre dışı bırakılmadı.

## U3 performance/cache — 18 Ekim 2026 (Türkiye)

### Remote source gate ve gerçek fark

| Kaynak | Doğrulanan SHA | Base / karar |
|---|---|---|
| main | `810adc2f7e82da52d8dd6768fcd5cf1d3040e106` | Değiştirilmez |
| #143 başlangıç | `f68b5157a41e2d5fe8656e394a3bdd2d5db82fc3` | Draft; base feature/r19-tmdb-secure-proxy / 98423240d1f966388e74aa4249632b1c921b3c4b |
| #130 | `90fda3b1abe696f07aa2c64ed9be32b5ac6f6dea` | Base feature/r18-presentation-foundation-1b / 72b1e1f2f484c1a627ee2fc5c19d88cbf2d6adaa |
| #131 | `fb87735ce4a95464ba85f1d4922e5f616e6d3112` | Base feature/r18-performance-observability / 90fda3b1abe696f07aa2c64ed9be32b5ac6f6dea |

#130 ile U2 merge-base'i 72b1e1f…; #131'in kendi base→HEAD farkı #130'u tekrar saymaz. #130 kendi farkı 16 dosya, #131 kendi farkı 13 dosyadır (workflow/package/test dahil). Üretim patch'leri üç yönlü olarak temiz uygulandı; daha yeni dosyalar bütünüyle kopyalanmadı. U2 Hero/native fixes ve #143 geçmişi korunur. Source workflow filtreleri ve package dosyası kopyalanmaz; test kapıları mevcut exact-HEAD Quality'ye eklenir, APK workflow'ları değişmez.

### Özellik fark kararları

| Özellik | Sınıf | Gerekçe / gerçek dosya |
|---|---|---|
| Cache hydration / ayrı provider identity / staged atomic yayın | ALREADY COVERED | catalogAvailability, catalogCache, m3uCatalogCache, xtreamKindCache, stalkerLiveSync; mevcut temel korunur |
| Startup/provider/cache/query/VLC paneli | ADAPT | performanceDiagnostics, RootLayout, PlayerContext, CatalogSyncContext, HomeDiscovery, catalogRuntime, VlcPlaybackSurface |
| 24/72 saat refresh policy ve timestamp okuma | INTEGRATE | catalogRefreshPolicy, CatalogSyncContext, catalogCache mevcut nullable sütunları |
| Tek koordinatör ve ayarlar | ADAPT | CatalogSync refreshCatalog; CatalogRefreshSettings iki shell'de |
| #131 M3U completion ve late snapshot | ADAPT | Sonuç ownership release öncesi doğrulanır; UI timestamp publication guard'dan sonra |
| Görünür listeyi boşaltan reload | ADAPT | useCatalogPage + catalogRefreshWindow; sadece yüklü pencere yeniden okunur |
| Her aktivasyonda eski 1.25s otomatik çağrı | REJECT WITH REASON | Kullanıcı tazelik tercihini atlar ve istek üretir |
| Yeni toplam disk/LRU kotası, native heap/PSS ve gerçek frame ölçümü | DEFER | Kaynak PR'larda yok; ölçüm/ürün sözleşmesi olmadan keyfî sınır veya PASS yok |

### Ölçüm sözleşmesi

Birim **ms**; monotonic performance.now (yoksa Date.now fallback), negatif fark sıfıra sınırlandırılır. Generic sample durumları PENDING/SUCCESS/ERROR/CANCELLED/TIMEOUT. Eksik alt event çifti NOT_OBSERVED; duplicate VLC/buffering olayları bir kez tutulur. Tanılama deadline'ı standart fazlarda 120.000 ms, katalog refresh'te 600.000 ms; bunlar yalnız örnek sınıflandırır, iş/transport iptal etmez. Timeout snapshot okunurken veya bitiş olayında değerlendirilir; polling timer eklenmez.

| Ölçüm | Başlangıç → bitiş | Kanıt / sınır |
|---|---|---|
| APP_STARTUP | Root mount → Home ilk kullanılabilir React effect | RootLayout/HomeDiscovery; ilk fiziksel piksel değildir |
| PROVIDER_PREPARATION | Player readState hydration başı → başarı/hata | PlayerContext; portal handshake'in ayrı cihaz süresi değildir |
| CACHE_HYDRATION | Snapshot read başı → current snapshot yayını | CatalogSyncContext; eski ownership CANCELLED |
| FIRST_CATEGORY | Paged category reload → current category verisi hazır | PagedCatalogViews; gerçek görünürlük veya Stalker lazy VOD/Series iç fazları değildir |
| FIRST_CONTENT | İlk paged query → React state commit effect | useCatalogPage; gerçek frame ölçümü değildir |
| PROVIDER_SWITCH | setActiveProvider başı → mevcut async sonucun boolean sonucu | PlayerContext; cold/warm karşılaştırması fiziksel PASS değildir |
| PLAYBACK_START | Bilinen entry tap → VLC_PLAYING/ERROR/EXIT | beginPlaybackAttempt + URI'ye bağlı callback token; eksik callback NOT_OBSERVED/TIMEOUT |
| LIVE_SWITCH | Player queue canlı seçim isteği → VLC_PLAYING/ERROR/EXIT | Aynı engine; yalnız tanılama eklenir |
| CATALOG_REFRESH | Üç provider koordinatör işi → commit/retained error/cancel | Stalker Live-only; Xtream kinds ayrı; M3U commit boolean |

Kayıtlar RAM'de: 5 startup (cold + son warm), startup başına 192 olay, 8 playback ve deneme başına en çok 64 olay, 32 generic sample, 7 whitelisted gauge. Yalnız açık/kapalı tercihi AsyncStorage'da kalır. Tercih yüklenirken erken olaylar yalnız bounded, credentialsız alanlarla geçici tutulur; varsayılan kapalı. Snapshot raporu kullanıcı kopyalayana kadar ağ/disk gönderimi yoktur. İzleyici hatası ürün işini durdurmaz.

Gauge'lar: katalog/Home satır sayıları; kullanılabilir cache okuma hit/miss gözlemleri; bilinen stamp ile expired refresh gözlemi; yenileme hata sayacı; runtime varsa JS heap byte. Android heap/PSS mevcut değilse NOT_OBSERVED. Kayda provider URL/ID/name, username/password, MAC/token, oynatma URL/query, TMDB/proxy/session secret alınmaz; provider yalnız enum türüdür. Stalker trace→attempt bağlantısı son 8 iç ID ile sınırlıdır.

### Cache ve refresh sözleşmesi

- #131 ile aynı v1 varsayılan: otomatik açık, **24 saat**; alternatif **72 saat**. Manuel yenileme tercihten bağımsızdır. Aralık **tazelik/eşitleme** süresidir; cache silme/oynatma URL TTL'si değildir.
- Kullanılabilir cache önce sunulur; warm activation'da otomatik politika yüklenene kadar network işi başlatılmaz. Cold/boş catalog mevcut provider ingest/initial yolunu kullanır; manuel yenileme açıktır.
- Provider+generation sahipliği snapshot, timestamp, timer callback ve publication sınırında denetlenir. M3U current-predicate queue başında ve transaction swap assertStillOwned içinde uygulanır. Provider değişince eski yanıt yeni UI oturumuna yayımlanmaz.
- Aynı current run paylaşılır. Otomatik hata aynı activation/başarılı stamp/policy anahtarında sürekli denenmez; manual, provider aktivasyonu veya politika değişimi yeni deneme fırsatıdır. Transport timeout değerleri korunur; M3U gerçek network abort eklenmedi, logical discard ve SQL rollback vardır.
- Mevcut kategori/arama/sort/query kimliği değiştirilmez. Refresh listeyi sıfırlamaz; yüklenmiş prefix cache'den tekrar okunup tek state yayınıyla değişir. Eski pagination/ID'ler sadece yeni sonuç doğrulanınca değiştirilir. Offline hata mevcut pencere ve devam cursor'unu tutar; kaldırılmış içerik için eski Info kapatılması hâlâ geçerlidir.
- Xtream Live/VOD/Series bağımsız sync ve başarısız türün cache'ini tutma davranışı korunur. Terminal partial/error sonucu da UI'ye yeni cache okuma revision'ı verir; yalnız tam başarılı stamp TTL'yi ilerletir.
- M3U katalog staging swap kalır; kimlikler yeniden yazılmaz. Background EPG yalnız EPG kaynağı değiştiğinde invalidate edilir; mevcut bağımsız EPG sistemi 24/72 saat katalog policy'sine çevrilmez.
- Stalker policy Live içindir; VOD/Series page/session/create_link ayrı kalır. Geçici link kalıcı ID olmaz; Stalker EPG tanı probu üretim EPG özelliği sayılmaz.
- Mevcut Home preview 48, yeni içerik 24, paged sorgu 100/default ve 200/max, SQL logical batch 200 sınırları korunur. Refresh pencere sınırı kullanıcının zaten yüklediği satır sayısıdır. Kalıcı tam katalog için global row/byte eviction kotası **yoktur**; bu açık CACHE-002'dir. Keyfî kota ile içerik kırpılmadı. Eski DB nullable timestamp sütunları zaten vardı; schema reset/migration yapılmadı; NULL stamp'li kayıt okunur.

### Kaynak kusurları ve test kanıtı

1. Eski snapshot timestamp'inin ownership kontrolünden önce yazılması giderildi; gerçek CatalogSyncProvider host testinde provider A/B geç yanıtı korunur.
2. #131'in observeM3UCacheWrite finally release'i sonrasındaki isCurrent kontrolü her başarıyı false yapıyordu. finishOwnedCatalogCommit sonucu release öncesi doğrular; başarılı/stale/failed üç grup testi var.
3. useCatalogPage reload önce emptyState yayımlıyordu. Kaynak window helper'a bağlandı; query/provider değişimi ayrı reset kalır; refresh hata/iptal eski pencereyi silmez.
4. Source #131'in çıkardığı background ownership kaynak kontrolleri yeniden güçlendirildi; yeni üçüncü persistence predicate argümanı denetlenir. Hiçbir test kaldırılmaz/skip edilmez. İmza değişimlerine ilişkin statik marker'lar güncellenir; gerçek coordinator + SQLite testleri ek kanıttır.

Yeni kapılar: #130 diagnostics 19; U3 lifecycle/privacy 11; policy senaryoları; production coordinator 9; production host SQLite 6; window/policy/ownership 9. Host adapter ve SQLite testleri Android layout/scheduling/firmware veya gerçek provider performansı değildir. Mevcut U2 ve Native JVM/Player/Back/orientation/Elite/TMDB kapıları korunur.

### Teslim ve açık işler

Yalnız integration/legendstream-u1 normal ileri güncellenir; küçük logical commit'ler kaynak SHA ve adaptasyon izini taşır. GitHub blob/tree SHA eşitliği yerel doğrulanan commit ağaçlarıyla karşılaştırılır; final ref update eski HEAD lease'i ve force=false ile yapılır. PR #143 Draft ve base #142 kalır. Final HEAD ve iki Quality run, PR açıklaması/Checks içinde doğrulanır; belge kendi commit SHA'sını uydurmaz.

Native TV Physical FAIL, TMDB LIVE BLOCKED ve legacy 14 SKIP aynen korunur. APK/workflow dispatch veya sunucu dağıtımı yapılmaz. U3 tamamlandı diye U2 telefon portrait policy açığı veya Elite Home/Live/Player/Series Info parity kapanmaz. U4 için ortak Elite ekran/action parity önerilir; fiziksel test ancak bütünleşik RC ve kullanıcı onayıyla.

History/Continue Watching ve yerel download açılışları da yeni playback denemesi başlatır. PLAYER_EXIT sonrası active attempt temizlenir; geç VLC callback eski raporu yeni oturum gibi tamamlayamaz. Bu ek yalnız tanılama çağrısıdır; history referansı veya resolver davranışı değişmez.

Eski 1,25 saniyelik M3U scheduler kaldırıldıktan sonra tüketilmeyen activationProviders Set/mark çağrıları da kaldırıldı; sıcak cache işaretleri gereksiz bellekte birikmez. Tazelik kararının tek sahibi CatalogSync olur. Yerel tam Quality 69/69 shell kapısında geçti; final yayın yine yeni exact-HEAD GitHub push ve PR koşularını gerektirir.

## U4.1 — Home film eylemi; 18 Ekim 2026 (Türkiye)

Başlangıç remote #143 HEAD `3eb8b55230b77e26e7f634be88aafbaefa3d6a1e`; base `feature/r19-tmdb-secure-proxy`; PR Draft. Yalnız `integration/legendstream-u1` ileri taşınır. U4.1 için eski feature branch'lerden toplu dosya kopyalanmaz.

`OptimizedHomeScreenPaged.tsx` Home seçimini `useHomeMovieInfo` üzerinden mevcut `MovieInfoModal` bileşenine bağlar. Modalın yerel fallback, TMDB erişim politikası, movie-info scope/Back ve Inspector uygulaması değiştirilmez. İzle mevcut `resolveCatalogPlaybackSource` kullanır; Home kökenli oynatma `returnTo: home`, Movies katalog kökenli oynatma mevcut `movies` dönüşünü korur. Provider-scoped kimlik ve refresh sonrası güncel nesne kullanılır; eski modal ve çift Play engellenir.

Sınıflandırma: Xtream/M3U Home film eylemi **INTEGRATED (source)**; mevcut Film Info sunumu/resolver **ALREADY COVERED**; Stalker exact-item Home Info **DEFERRED**; Series Info ve Elite Home/Live/Player/overlay parity **PARTIAL / OPEN**. Tam U4 bitmedi.

Yeni test: 15 host-hook/kaynak sözleşmesi senaryosu. Yerel ve remote final Quality sonuçları PR Checks / exact-SHA run metadata üzerinden izlenir; aşağıdaki yeni run doğrulanmadan önceki PASS devralınmaz. Fiziksel kabul yoktur; Native TV tarihsel FAIL, TMDB LIVE BLOCKED ve 14 SKIP legacy kaydı korunur.

U4.1 yerel doğrulama: mevcut Quality tanımındaki **71 shell kapısı / 71 PASS**, test kaldırılmadı veya atlanmadı. TSX girişleri yerelde `node --import tsx` ile aynı senaryolara çalıştırıldı; GitHub standart Quality komutlarını kullanır. Yeni U4 testi **15/15 PASS**. Mobil/API/tam workspace typecheck geçti. Bu sonuç henüz remote final SHA Quality veya fiziksel PASS değildir.

## U4.2 — Stalker Home Film Info; 18 Ekim 2026

Remote başlangıç PR/branch HEAD `8c1d0e86cc8a24085d0a35105c2540a5bb62992f`; main `810adc2f7e82da52d8dd6768fcd5cf1d3040e106`; base `feature/r19-tmdb-secure-proxy` @ `98423240d1f966388e74aa4249632b1c921b3c4b`; PR Draft. Başlangıç Quality push #1261 ve PR #1262 SUCCESS. U3 ve U4.1 yeniden uygulanmadı.

Seçim noktaları: `HomeDiscovery` Hero movie, film rafı, ortak Yeni Filmler rafı → aynı onOpenMovie. `StalkerMainPage` bugün Yeni Filmler kaynağını boş verir; bu dilim yeni raf/veri kaynağı üretmez. `useStalkerHomeSummary` artık eski Xtream biçimli sunum projeksiyonu yanında orijinal provider-scoped güvenli preview'ları sunar.

`useStalkerHomeMovieInfo` + `stalkerHomeMovie` controller seçimi provider/runtime-session/portal ID'ye bağlar. Info yerel preview'la hemen açılır; metadata için mevcut servis kullanılır. Play: bir locator sayfası exact ID doğrulaması → mevcut `resolveStalkerVodLink` → mevcut shell Player. Locator yoksa yalnız eski özetin kaynak sözleşmesi olan All/ilk kategori ilk sayfası; sayfa dolaşımı/title match yok. V1 schema korunur; opsiyonel locator yalnız kategori/page, cmd/token/play URL yok. Runtime registry'ye eklenen read-only ownership ve değişim bildirimi session yerine yenisini yaratmadan iptali sağlar; auth/transport/create_link protokolü değişmez.

Ortak `MovieInfoModal` varsayılan davranışı korunarak yalnız async Stalker Home için closeOnPlay=false, busy/error ve retry sunar. Modal Back ilk odak ve movie-info scope kullanır. Home Player arkasında bağlıdır; dış scroll/Hero autoplay modal veya Player sırasında durur. Origin Home ve Movies ayrı kalır. Native physical restore owner yeniden yazılmaz; gerçek konum/focus kabulü RC'dir.

Yeni servis testi 14 senaryo; hook/shared-modal/Preview host testi 13 senaryo. Bunlar fiziksel Android testi değildir. Mevcut Home preview kaynak testinin locator çağrı assertion'ı güçlendirildi. Exact final SHA/run sonuçları PR Checks ve logdaki QUALITY_EXACT_HEAD üzerinden izlenir; kendi commit'ine sahte SHA yazılmaz.

Series incelemesi: GoldenSeriesDetailModel/StalkerSeriesProductSurface mevcut katalog başlık-sezon-bölüm yapısıdır; Home exact-series, ortak Elite metadata/detail ve origin restorasyonu eksikleri U4.3'e ayrıldı. U4.2 film dilimi bununla genişletilmedi. Tam Elite Home/Live/Player/overlay, orientation ve U3 borçları açık. Tarihsel Native TV Physical FAIL, yeni kaynak NOT TESTED/DEFERRED_RC, TMDB LIVE BLOCKED ve 14 SKIP/0 DELETED aynen korunur.

U4.2 regresyon uyarlaması: üç eski kaynak assertion'ı yeni sözleşmeyi doğrular: Home preview locator çağrısı; Movies varsayılan dönüşü + Home override + aynı player handoff; history/progressRef ile origin-aware Movies dönüşü. Senaryolar kaldırılmadı, provider/secret kontrolleri gevşetilmedi. İlk yerel turda bunlardan biri eski sabit Movies imzasını beklediği için başarısız oldu; sözleşme güçlendirilip ilgili suite yeniden çalıştırılır. Geçici pnpm10 önbelleği eksikliği restore edildi; redaksiyon kapısı da yeniden çalıştırılır.

U4.2 son yerel tur: **74/74 shell Quality kapısı PASS**, U4.2 servis **14/14**, hook/modal/Preview host **13/13**. Mobil, API ve tam workspace typecheck geçti. TSX yerelde IPC sınırı nedeniyle aynı girişlere `node --import tsx` ile çalıştırılır; CI standart komutları kullanır. Remote kabul yalnız final HEAD'in yeni Quality koşularıdır.

## U4.3 — Series Info ve bölüm navigasyonu; 18 Ekim 2026

Başlangıç #143 HEAD `2103a6f56b307a81c43b1e052c0e93898141e374`; main `810adc2f7e82da52d8dd6768fcd5cf1d3040e106`; base `feature/r19-tmdb-secure-proxy` @ `98423240d1f966388e74aa4249632b1c921b3c4b`; Draft. Başlangıç push Quality #1263 / PR Quality #1264 SUCCESS. U3/U4.1/U4.2 yeniden uygulanmadı.

Bulgu→çözüm: Stalker Home yalnız Series tab'ına gidiyordu → aynı mevcut StalkerSeriesProductSurface initialSeries exact-ID targeted detail yolunu kullanır, kategori/tam katalog yüklemez. Xtream/M3U Home openSeries state'i yükleniyor ama Home detay göstermiyordu → ortak paged flow origin Home/Series saklar ve aynı SeriesInfoModal açılır. GoldenSeriesCatalog inline detail artık shared modalı kullanır; arka grid bağlı kalır. Mobil episode Player eski early-return ile detay state'ini kaldırabiliyordu → yalnız aktif series flow için katalog+modal state'i bağlı tutulur; film dönüşü aynı kalır.

Yeni `seriesInfo` adapters yerel metadata ve explicit episode progress refs üretir; `pagedSeriesFlow` hedefli load/resolve işlemlerini provider ownership + selection ticket + AbortSignal ile korur. M3U Play güncel tek grubu yeniden okur; eksik bölümde başka bölüme düşmez. Eski legacy-provider fallback çağrısı korunur. Stalker mevcut controller/resolver'da protokol değişmez; iptal edilmiş detail yanıtının RAM playbackRefs'i overwrite etmesi publication öncesi abort check ile engellenir. Runtime session değişimi istekleri ve double-tap gate'ini geçersiz kılar.

Ortak ekran yalnız provider verisini gösterir; TV TMDB endpoint/backend eklenmez. Mevcut alanlar image/overview/genre, season/episode, varsa episode plot/duration ve provider+episode ref ile progress'tir. Eski çok-sezon Back→sezonlar adımı yerine tek Back→kaynak ekran sözleşmesi seçildi; sezonlar yatay seçicide erişilebilir. Player sırasında modal suspend edilir; aynı component season/episode/offset state'i korunur. Android fiziksel focus/scroll restore kabulü verilmez.

Provider destek sınırı: Xtream ve Stalker mevcut detay sözleşmeleri; M3U yalnız mevcut cached hierarchy. Hierarchy yoksa hata/retry veya boş durum; sahte destek yok. Stalker episode DTO'sunda olmayan metadata ve hierarchyTruncated sınırı kayıtlı kalır. Player'ın kendi Next/queue/progress motoru yeniden yazılmaz.

Güncel kayıt tablosu U4.2 filmini OPEN göstermeyecek şekilde düzeltildi; eski U2/U4.1/U4.2 notları tarihsel olarak ayrıldı. U4.3 yerel Series Info kaynak işi tamamlanması tam Elite U4 veya fiziksel kabul anlamına gelmez. Native TV tarihsel Physical FAIL, güncel NOT TESTED/DEFERRED_RC, TMDB LIVE BLOCKED, 14 SKIP / 0 DELETED korunur.

U4.3 yeni doğrulama kapsamı: **31** production controller/hook/Stalker surface/shared-modal/Preview host senaryosu ve production TvFocusPolicy üzerinde **4** ek Series Info scope JVM senaryosu. Eski kaynak assertion'ları taşınan UI/model/episode resolver üretim dosyalarını okur; Live/VOD resolver, provider kimliği, history/progress ve credential güvenlik kontrolleri korunur. Native firmware/Android Dialog kabulü değildir. Sonraki tek sınırlı öneri: Elite Live sunumunu telefon/tablet/Preview gerçek yollarına bağlamak; tüm Elite ekranları birden dönüştürmek değil.

U4.3 son yerel otomatik tur: **76/76 shell Quality kapısı PASS**; U4.3 **31/31** host/model/service senaryosu; Native JVM focus **66/66** (dört yeni Series scope senaryosu dahil), mevcut stability/reachability kapıları korunur. Mobil, API ve tam workspace typecheck geçti. TSX yerelde aynı girişlerle node --import tsx üzerinden çalışır. Final remote SHA ve iki CI run, PR Checks/logdaki QUALITY_EXACT_HEAD üzerinden doğrulanır; önceki yeşil sonuç devralınmaz.


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
