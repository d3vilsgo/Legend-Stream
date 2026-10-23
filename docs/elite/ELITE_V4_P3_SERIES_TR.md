# Elite V4 P3 — Premium Series

Tarih: 23 Ekim 2026. Repository: d3vilsgo/Legend-Stream. PR #143 OPEN/DRAFT; branch integration/legendstream-u1; base feature/r19-tmdb-secure-proxy.
Başlangıç HEAD: `4271184ac380f41bc2c9158b58db7e4ee0bb6cc9`. Remote PR ve tüm kaynak blob SHA'ları doğrulandı; eksik/değişik başlangıç dosyası yoktu.

## Uygulama ve tasarım

Sidebar Series artık bağımsız V4 ekranına gider. Movies Hero/poster sunumu generic provider kartı ve opsiyonel Series sunumuyla paylaşılır; Movies varsayılan davranışı korunur. Seri kimliği ve detay/oynatma akışı film kimliğinden ayrıdır. Ortak V4 token'ları, 1 dp turkuaz Focus, kalan slot genişliğine göre satır sanallaştırması, iki satırlı kart başlığı ve odakta kaydırma kullanılır. Hero yüksekliği ekranın %30'u, 164–280 dp minimum yükseklik; yazı doğal akışta büyüyebilir. TV en çok 6 sütun, mobil/tablet genişliğine ve yazı ölçeğine uyarlama.

SeriesInfoModal yalnız `variant="eliteV4"` ile kompakt grafit görünüm, küçük tipografi, ince Focus ve opsiyonel bölüm görselleri kullanır. V3 varsayılan stil/4 dp kontrol tanımı ve mevcut navigasyon korunur. V4'te detay/sezon/bölüm seçimi ve kaydırma bağlamı en fazla 48 sağlayıcıya bağlı kayıtla oturum içinde hatırlanır. Gerçek provider ilerlemesi eşleşirse bölümde Devam et bilgisi gösterilir; mevcut Player açık progressRef ile mevcut resume mekanizmasını kullanır.

## Sağlayıcı destek matrisi

| Sağlayıcı | Katalog/kategori/arama/sıralama | Sezon/bölüm | Oynatma |
| --- | --- | --- | --- |
| Xtream | useCatalogPage(kind=series), gerçek kategori deposu; provider/default, alfabetik, son eklenen sorguları | Mevcut getSeriesInfo; gerçek episodes[seasonId] ve episode ID | usePagedSeriesInfo → resolveCatalogPlaybackSource(kind=episode); extension/direct_source korunur |
| M3U | Gerçek playlist'ten önbelleğe alınmış dizi grupları, kategoriler ve arama/alfabetik sorgu | loadM3USeriesInfoFromCache; hiyerarşi yoksa açık boş/hata durumu | Gerçek seçili bölüm yeniden okunur, registerLocalEpisodeQueue ve mevcut resolver; m3u-episode itemId |
| Stalker | Mevcut kayıtlı oturum ve createStalkerSeriesProductController; gerçek kategoriler ve sınırlı sayfalama; arama seçili kategori sayfalarında | Portal series hedefli hiyerarşisi ve mevcut VOD compatibility fallback; yalnız normalize edilmiş kayıtlar | controller.resolveEpisode → vod/create_link, sağlayıcının opaque cmd değeri ve exact episodeId |

Stalker sıralaması yalnız yüklenmiş kayıtlar üzerinde uygulanır ve UI'da açıklanır. Portal toplam/sayfa boyutu vermiyorsa mevcut controller sonraki sayfa varlığını varsaymaz. Arama mevcut bounded controller limitleriyle sınırlıdır; eksiksiz portal taraması iddiası yoktur. Hiyerarşi kesilmişse uyarı gösterilir. Eksik cmd/ID, kullanılmayan sezon/bölüm ve oturum değişimi oynatmaya dönüşmez. Üretim koduna sahte katalog/URL eklenmedi. Gerçek abone bağlantıları rapor veya teste yazılmadı; test URL'leri yalnız fixtures içindedir.

## TMDB

Mevcut MovieInfoService ve TMDB Direct HTTPS bağlantısı kullanılır; tr-TR sözleşmesi korunur. Hero/detail gerçek provider dizisinin metadata eşleşmesini tüketir. Seçilen sezonun açık sayısal numarası ve doğrulanmış Series metadata kimliği varsa mevcut fetchTmdbSeason(token, seriesId, seasonNumber, tr-TR) çağrılır. Bölüm metadata'sı ancak tekil, açık provider episodeNumber eşleşmesinde eksik açıklama/görsel/başlığı doldurur. Veri seti daima provider episode listesidir; TMDB-only sezon/bölüm üretilmez. Kimlikler/URL/progressRef metadata ile değiştirilmez. Opaque sezonda veya bölüm numarası yoksa bölüm eşleştirmesi yapılmaz. Eski sezon yanıtları ve unmount sonuçları yok sayılır. Metadata başarısızlığı provider görünümünü kaldırmaz. Direct transport, backend, proxy, token yönetimi değiştirilmedi.

## Focus ve eşzamanlılık

Sidebar → Series → Hero/kategori → Grid → scoped Series Info → sezon → bölüm → mevcut Player akışı bağlandı. Native Android FocusFinder ve mevcut native scope sahibi korunur; sanal D-pad mevcut Preview scope kullanır. Player sırasında detay mounted kalır ancak görünmez; çıkışta yeniden görünür ve önceki bölüm/kaydırma bağlamı korunur. Shell, episode dönüşünde modal arkasına içerik Focus'u göndermez. Modal kapanınca aynı katalog kartına dönülür. Aramada BACK önce aramayı kapatır, katalog BACK Home'a gider. Grid LEFT Sidebar'a gider. Yeni sezon seçiminde eski render'ın OK callback'i reddedilir; aynı frame'de çift OK kilitlenir. Provider, katalog scope, session, detail veya route değişimi eski resolver'ın Player açmasını engeller.

## Test kanıtı

Yeni `eliteV4SeriesProductionScenarios.mjs`: 22/22. Gerçek SeriesCatalog, generic MoviesView/Hero, SeriesInfoModal, usePagedSeriesInfo, Shell/Sidebar/Focus ve mevcut Stalker controller çalıştırılır. Native ortam/network/context sınırları host doubles ile sağlanır; bu canlı abone/cihaz testi değildir.

Regresyon: V4 Home/Sidebar/Focus host 18/18; V4 Live 14/14; V4 Movies 14/14; U4.3 Series 40/40; Home Movie Info 15/15; R17-H4 season 15/15; R17-E Series Player foundation 24/24; R17-F episode history/resume 41/41; Home/Focus model 13/13; TMDB foundation 57/57; TMDB Movie Info 35/35. TypeScript ve hedefli Prettier kontrolleri yürütülür. Yeni Series suite mevcut Quality üretim host girişine import edildi; format kapısına yeni dosyalar eklendi. Önceki test assertion'ları gevşetilmedi veya atlanmadı.

Final commit için exact-SHA Quality run numarası/sonucu teslim mesajında ve GitHub Actions kaydında doğrulanır. Başlangıç Quality #1628 bu yeni kaynak için PASS sayılmaz; bu dosya gelecekteki CI başarısı iddiası değildir.

## Değiştirilen dosyalar

- components/eliteV4/EliteV4SeriesCatalog.tsx (yeni)
- lib/eliteV4Series.ts (yeni)
- tests/eliteV4SeriesProductionScenarios.mjs (yeni)
- components/eliteV4/EliteV4MoviesCatalog.tsx (opsiyonel ortak Series sunumu)
- components/eliteV4/EliteV4Sidebar.tsx ve EliteV4TvShell.tsx (Series route/episode handoff)
- components/series/SeriesInfoModal.tsx (opsiyonel V4 varyant)
- lib/eliteV4Movies.ts (ortak sunum kart tipi)
- lib/goldenSeriesDetail.ts ve lib/seriesInfo.ts (provider bölüm görseli/puan alanları)
- tests/eliteV4ProductionHostScenarios.mjs (yeni suite import)
- tests/eliteV4MoviesProductionScenarios.mjs ve eliteV4LiveProductionScenarios.mjs (yeni bağımsız Series sınırını stub; mevcut assertions aynı)
- .github/workflows/quality.yml (yeni dosyaların format kontrolü)
- Bu rapor ve docs/project altındaki FEATURE_PARITY_MATRIX_TR, INTEGRATION_LEDGER_TR, OPEN_ISSUES_TR, PRODUCT_ROADMAP_TR, RELEASE_ACCEPTANCE_TR kayıtları.

Kod yolları artifacts/legendstream-xplayer altındadır; workflow/docs hariç.

## Açık kabul ve sınırlar

Fiziksel kabul: **DEFERRED_RC**. Homatics 4K V2 ve telefon/tablet üzerinde gerçek Android pencereleri, FocusFinder, ağ ve playback kabulü yapılmadı. Gerçek uygulama ekran görüntüsü üretilmedi; host çıktısı ekran görüntüsü olarak sunulmaz. Canlı TMDB/sağlayıcı testi iddiası yoktur. P0 temel kullanıcı kabulü ile tarihsel Physical FAIL/diğer açık kayıtlar korunur.

V4 Stalker Live, Continue Watching/Settings tam ekran parity ve bütünleşik cihaz RC kabulü ayrı açık kapsamdır. GEN2, V3 üretim ekranları, Live TV bileşeni, provider sözleşmeleri, TMDB Direct API ve Player servisleri değiştirilmedi. Genel ürün parity PARTIAL kalır.

APK üretilmez. Commit `[skip apk]` taşır; mevcut Android APK guard korunur. Series ve kalan Stalker Live tamamlandıktan sonra bütünleşik Universal APK ayrı aşamadır. PR #143 merge edilmez, yeni branch/PR oluşturulmaz.
