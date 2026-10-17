# U1 Entegrasyon Defteri

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
