# LegendStream XPlayer — Tek Ürün Yol Haritası

## Hedef ve çalışma politikası

Tek uygulama; telefon, tablet, Android TV/Google TV/TV Box ve TV Preview için aynı Legend Elite V2 marka, içerik ve temel davranış sözleşmesi. Ekran geometrisi ve giriş yöntemi uyarlanır. Xtream, M3U ve Stalker resolver/oturum mekanizmaları ayrı kalır.

Proje aşaması: **GLOBAL INTEGRATION & FEATURE COMPLETION**. APK ve fiziksel kabul, ana geliştirmeler ile otomatik doğrulamalar bittikten sonra bütünleşik Release Candidate için kullanıcı onayıyla başlar. Quality PASS ve Physical PASS ayrı kayıtlardır.

## Dilimler

| Dilim | Kapsam | Durum / çıkış kapısı | Sorumlu hat |
|---|---|---|---|
| U1.1 | #142 kaynak ağacı + #138'in eksik üç Native TV onarımı | Bu branch; exact-HEAD Quality ve Draft PR ile izlenir. Ürün bütünü tamamlandı değildir. | U1 kaynak entegrasyonu |
| U2 | #121/#126 grid, #122/#127 Hero, #124/#133 navigasyon, #125/#132 sunum temeli | Kaynak bağlantıları bu branch'te; exact-HEAD Quality zorunlu. Telefon katalog portrait politikası ve tam Elite ekran parity açık kalır. | Ortak sunum |
| U3 | #130 performans gözlemi + #131 cache-first refresh | SOURCE_INTEGRATED / ADAPTED; bounded tanılama, 24/72 saat politika, sahiplik ve cache window koruması; exact-HEAD Quality gerekir | Provider/cache/performance |
| U1.4 | Elite ekranlar ve ortak içerik eylemleri | PARTIAL: Home→Film Info U4.1/U4.2; yerel Series Info U4.3 kaynakta bağlı. Tam Elite Home/Live/Player/overlay açık | Elite ürün parity |
| U4.2 | Stalker Home Film Info | SOURCE_INTEGRATED; güncel fiziksel NOT TESTED; sayfa-locator sınırı kayıtlı | İçerik detay |
| U4.3 | Ortak yerel Series Info + Home/Series origin + sezon/bölüm | SOURCE_IMPLEMENTED; final exact-SHA Quality ile izlenir; fiziksel NOT TESTED | İçerik detay |
| U1.5 | TMDB canlı bağlantı | LIVE BLOCKED; onaylı HTTPS hosting, güvenilir session issuer, sunucu secret bağlantısı, atıf ve gerçek uçtan uca kanıt gerekir | Metadata/backend |
| RC | Bütünleşik otomatik doğrulama + tek kaynaklı RC kabulü | Henüz başlamadı; fiziksel test yalnız kullanıcı onayıyla | Release kabulü |

## U1.1 tarihsel kaynak envanteri — güncel kararlar aşağıdaki U2 tablosunda

| Kaynak | U1.1 kapsamı | Sonraki iş |
|---|---|---|
| #120 | Yalnız scripts/tsconfig.json root typecheck onarımı alındı; hijyen PR'ının tamamı alınmadı | Node/pnpm pin, kullanılmayan bağımlılıklar, API trust-proxy, ek test kapıları ve belgeler tek tek uzlaştırılmalı |
| #121 | Responsive VOD/Series görsel kolu alınmadı | Film Info girişlerini ve güncel Native ölçüleri koruyarak grid farklarını seç |
| #122 | Eski mobil landscape Hero düzeltmesi alınmadı | #127 ile tek mobil/tablet/Preview bütçe sözleşmesi |
| #123 | main'deki presentation/orientation temeli miras | Sonraki #129 politikasının fiziksel kabulü devraldığı varsayılmaz |
| #124 | Ayrı kompakt landscape nav kolu alınmadı | #133 ile davranış seçimi; telefon katalog landscape politikası açık |
| #125 | Özgün branch bütünüyle entegre sayılmaz; evrilmiş token/helper'lar #132 üzerinden kısmen miras | Ortak semantic token ve gerçek ekran kullanım haritası |
| #126 | computePosterGridLayout gerçek katalog bağlantısı bu dilimde taşınmadı | Tablet/telefon grid ve scroll restorasyonu |
| #127 | Height-bounded mobil/tablet Hero kolu alınmadı | Native #138 modelini koruyan sunum birliği |
| #128/#129/#132–#137 | #142'nin atalarından gelen kaynak mirası korunur | Kabul borçları FEATURE_PARITY_MATRIX ve OPEN_ISSUES içinde |
| #130/#131 | Performans/cache ayrı dalı alınmadı | Ölçüm + cache-first semantik entegrasyonu |
| #138 | Eksik üç commit cherry-pick ile taşındı | Fiziksel FAIL kaydı açık; yeni birleşik kaynak NOT TESTED |
| #139–#142 | Elite Live, Film Info, matcher/cache/proxy kaynakları korunur | Elite ekran parity ve TMDB LIVE BLOCKED kapanmadı |

Yeni görev önce bu dilimlerden birine bağlanır. Önceki görev sessizce kapanmaz: geliştirme, Quality, fiziksel kabul, açık kusur ve sonraki eylem ayrı güncellenir. Commit veya Quality tek başına ürün tamamlanması sayılmaz.

Bağlı kayıtlar: [parity](FEATURE_PARITY_MATRIX_TR.md), [kusurlar](OPEN_ISSUES_TR.md), [kabul](RELEASE_ACCEPTANCE_TR.md), [entegrasyon](INTEGRATION_LEDGER_TR.md).

## U2 güncel özellik sahipliği — PR #143

Önceki kaynak envanteri U1.1 anını anlatır. Aşağıdaki U2 sınıfları güncel davranış kararlarıdır; eski PR'ların durumunu değiştirmez. INTEGRATED, kapsamındaki davranışın birleşik üretim yoluna alınmasıdır; bütün PR'ın merge veya fiziksel kabul edildiği anlamına gelmez.

| PR | U2 durumu | Gerçek üretim karşılığı / açık sınır |
|---|---|---|
| #120 | PARTIAL | U1 scripts typecheck onarımı korunur; kalan hijyen/API/CI işi ayrı |
| #121 | PARTIAL | VOD/Series responsive grid ve fontScale uyumlu iki satır başlık alındı; bağımsız kompakt katalog header/detail panel tasarımı DEFERRED |
| #122 | INTEGRATED | HomeHeroCarousel yüklü/boş/loading için ortak bounded geometri; orientation/ölçülen alan uyumu |
| #123 | ALREADY COVERED | Devralınan Player/orientation sahipliği korunur; eski fiziksel PASS yeni SHA'ya devredilmez |
| #124 | ALREADY COVERED | Evrilmiş #133 ResponsiveContentNav, kompakt telefon/tablet menüsü ve gerçek Native FocusButton yolu zaten U1'de |
| #125 | PARTIAL | Premium token/metrics temeli #132 üzerinden evrilmiş; eski token paleti bütün ekranlarda Elite V2 dönüşümü değildir |
| #126 | INTEGRATED | PagedMoviesCatalog, GoldenSeriesCatalog ve StalkerGoldenMoviesCatalog artık useResponsiveCatalogGrid kullanır |
| #127 | INTEGRATED | Mobil/tablet/Preview Hero token sınırları gerçek Home'a bağlandı; Native #138 bütçesi ayrı korunur |
| #132 | ALREADY COVERED | Tablet kimliği, safe-area ve presentation profile U1 atası; U2 measured grid/Hero tüketimi tamamlandı |
| #133 | ALREADY COVERED | Adaptif navigasyon U1 atası; U2 kompakt sekmeler mevcut Elite semantic accent/selected token'larını kullanır |
| #138 | ALREADY COVERED | U1 kaynak izli üç onarım; Native geometri, Java Focus policy, input sahipliği ve Inspector değiştirilmedi |
| #130/#131 | DEFERRED | U3 performans/cache semantik uzlaştırması; U2 bu PR'ları entegre saymaz |
| #139–#142 | PARTIAL | Mevcut Elite Live / Film Info / TMDB kaynakları korunur; tam cihaz parity ve canlı metadata bitmedi |
| TMDB canlı | BLOCKED | TMDB LIVE BLOCKED devam; hosting/issuer/token ve uçtan uca kanıt gerekir |

U2'nin geometri/host otomatik kabulü gerçek cihaz kabulünden ayrıdır. Mevcut telefon katalog portrait kilidi değiştirilmedi; landscape hesapları oluşan yatay viewport için testlidir, serbest telefon katalog rotation özelliği tamamlandı değildir.

## U3 güncel kararlar — U2 tablosunun performans/cache satırlarını günceller

#130 ve #131'in uygun üretim davranışları **INTEGRATED / ADAPTED**. PR'lar merge edilmiş veya fiziksel kabul edilmiş değildir. Kaynak #130: `90fda3b1abe696f07aa2c64ed9be32b5ac6f6dea`; #131: `fb87735ce4a95464ba85f1d4922e5f616e6d3112`. #131'in gerçek base'i #130'dur; miras dosyaları iki ayrı özellik gibi sayılmaz.

| Kaynak işi | Gap kararı | Güncel karşılık |
|---|---|---|
| #130 startup/hydration/query/VLC ölçümleri ve rapor paneli | ADAPT | Üretime bağlı; token korelasyonu, olay sınırları, whitelist, eksik/timeout durumu eklendi |
| #130 provider trace/URL loglarıyla ölçüm ilişkilendirme | ADAPT | Yalnız iç trace→attempt ID eşlemesi; URL/token/MAC tanılama girdisi olmaz |
| #131 cache-first aktivasyon | ALREADY COVERED + ADAPT | Var olan cache hydration korunur; otomatik istekleri 24/72 saat tazelik politikasına bağlar |
| #131 varsayılan açık/24 saat, seçenek 72 saat, elle yenileme | INTEGRATE | Aynı v1 preference; iki ürün shell'inde ortak ayarlar |
| #131 single-flight / provider scope | ADAPT | Timestamp yayını sahiplik arkasında; timer callback guard; M3U transaction assertStillOwned |
| #131 M3U boolean completion | ADAPT | Sonuç sahiplik bırakılmadan doğrulanır; sonradan gate sorgulayıp başarıyı FAIL yapma kusuru giderildi |
| #131 yenilemede görünüm durumu | ADAPT | Liste boşaltılmaz; yüklenmiş pencere yeniden okunup atomik yayımlanır; query/provider değişimi ayrı reset |
| Eski 1,25 saniyelik her aktivasyonda otomatik yenileme | REJECT WITH REASON | Yeni tazelik tercihini atlar ve gereksiz provider çağrısı üretir |
| Native PSS/heap, frame görünürlük ölçümü, cihaz hız yüzdesi | DEFER | Gerçek cihaz verisi yok; NOT OBSERVED / NOT TESTED |
| Kalıcı katalog için toplam disk kotası/LRU | DEFER | Kaynak #131'de yok; katalogları sessiz kesmemek için keyfî sınır eklenmedi |

Sonraki önerilen dilim **U4: Elite V2 ekran/action parity** — Home, mobil/tablet/Preview Live, Player/overlay, Home→Film Info ve Series Info; telefon katalog orientation politikası ayrı kabul maddesi. U3'ün disk bütçesi ve ayrıntılı Stalker lazy VOD/Series ölçüm boşlukları açık izlenir. Fiziksel kabul yalnız bütünleşik RC ve kullanıcı onayıyla başlar.

## U4.1 — Home film eylemi (sınırlı kaynak dilimi)

Xtream/M3U Home Hero ve film rafları artık mevcut Elite Film Info modalına gider; doğrudan oynatma yalnız modalın İzle eyleminden başlar. `useHomeMovieInfo` provider-scoped içerik kimliğini saklar, güncel Home snapshot nesnesini yeniden seçer; kaldırılmış içerik, provider değişimi ve eski callback oynatmayı başlatamaz. Movies kataloğunun mevcut Info→Player yolu korunur; Home üzerinden Player çıkışı Home'a döner.

**U4 bütünü PARTIAL**. Stalker Home özeti yalnız portal ID ve sunum verisi taşır; Home film seçimi hâlâ Movies sekmesini açar. Sonraki dilimde güvenli current-session yeniden bulma, cancellation ve exact-item Film Info yolu kurulmalı. Series Info, tam Elite Home, touch/tablet/Preview Live ve Player/overlay görsel parity açık kalır. Telefon katalog orientation politikası bu işte değiştirilmez.

## U4.2 — Stalker Home Film Info

**SOURCE_IMPLEMENTED — exact-SHA Quality kapısıyla doğrulanır; Physical NOT TESTED / DEFERRED_RC.** Stalker Home Hero ve film rafındaki seçim portal ID üzerinden mevcut Film Info modalını açar. Stalker Home `newMovies=[]` verir; bugün ayrı Yeni Filmler kaynağı yoktur. Ortak Home Yeni Filmler seçim yolu aynı `onOpenMovie` sözleşmesini kullanır; sahte Stalker rafı oluşturulmadı.

Info anında yalnız yerel preview + mevcut metadata servisi kullanır. Açılışta provider isteği/create_link yoktur. İzle, kaydedilmiş kategori/sayfanın güncel session yanıtında exact portal ID'yi bulur ve mevcut `resolveStalkerVodLink` → shell Player yolunu kullanır. Yeni özet locator'ı yalnız kategori/sayfa içerir; cmd/session URL'si saklanmaz. Eski schema-v1 özetler okunur; locator yoksa provider'ın All/ilk kategori ilk sayfası bir kez okunur. Sayfadan taşınan/silinmiş filmde tüm katalog taranmaz; görünür hata, Tekrar dene ve Filmler kataloğunu yenile yönlendirmesi vardır.

Home kökeni Home'a, Movies kökeni Movies'e döner. Home/raf ScrollView ve yatay raf bileşenleri Stalker Player arkasında bağlı kalır; modal/Player sırasında Hero autoplay ve dış scroll durur. Odak ilk Back hedefi ve mevcut movie-info scope sistemiyle yönetilir. Gerçek Android scroll/focus ve kumanda dispatch kabulü RC'ye ertelidir.

**U4.3 / OPEN**: Series Info ve Home→seçilen dizi→sezon/bölüm. `StalkerSeriesProductSurface` katalog içinde Golden detail (başlık/sezon/bölüm) üretir; Home yalnız Series sekmesine gider. Xtream/M3U Home `openSeries` seçimi/yüklemesi, Series ekranına geçiş ve dönüş kökeniyle birlikte uzlaştırılmalı. TMDB series DTO tam Elite Series Info ekranı değildir. Bu bir film modalına küçük bağlantı değildir; U4.2 içinde genişletilmedi. Tam Elite Home/Live/Player/overlay ve orientation borçları açık kalır.

## U4.3 uygulama sınırı

Golden dizi detayının ortak sunumu `SeriesInfoModal` içine taşınır; ikinci metadata servisi yoktur. Home ve Series kaynağı aynı yerel detay/season/episode eylem sözleşmesini kullanır. Xtream mevcut getSeriesInfo, M3U yalnız hedefli persisted group hydration, Stalker mevcut movie_id hierarchy/controller/resolver yollarını korur. Film U4.1/U4.2 akışı yeniden uygulanmaz.

Series Player çıkışı açık detayın aynı seçim durumuna; detay Back kaynağı olan Home veya Series'e döner. Eski çok sezonlu inline detayda Back önce sezon seçicisine dönüyordu; U4.3 tek Back ile kaynak ekranına çıkmayı benimser, sezonlar ortak yatay seçicide kalır. Katalog/Home listeleri modal ve episode Player arkasında bağlı tutulur. Gerçek native focus/scroll/orientation kabulü RC'dedir.

Tam U4 bitmedi: Elite Home/Live/Player/overlay görsel parity, telefon katalog rotation politikası ve TV metadata live ayrı açık işlerdir.
