# LegendStream XPlayer — Tek Ürün Yol Haritası

## Güncel dilim — Visible Home & TV Remote Repair (18 Ekim 2026)

Bu dilim U4.3 sonrasında kullanıcının açık uygulama talebidir. U3/U4.1/U4.2/U4.3 tekrar uygulanmadı. Native TV ve mobil gerçek HomeDiscovery yolu yenilendi; yalnız showcase/altyapı teslimi değildir. Tam Elite Home/Live/Player dönüşümü veya U4 bütünü tamamlandı sayılmaz.

Sıra: (1) Dialog onShow + Player error/exit ve kanal görünürlüğü; (2) gerçek katalog nesnesiyle belirgin featured Home + beşli mobil gezinme; (3) kategori arama alt paneli, Preview için ayrılmış kumanda alanı, seçili sezonun viewport restorasyonu; (4) birleşik regresyon ve exact-SHA CI. Kaynak uygulama tamamlandı, **SOURCE_FIXED / PHYSICAL_RETEST_REQUIRED**. Başlangıç `ed94a373ce64ff1a006c27b712b731a8ed1eda3e`; base/Draft değişmez.

Telefon: Ana Sayfa/Canlı/Filmler/Diziler/Kitaplık. Kitaplık mevcut History/Favoriler/Devam Et ve Downloads yollarına bağlanır; yeni indirme yeteneği uydurulmaz. Yatay/tablet aynı beş hedefin kompakt yatay düzenini kullanır; kalıcı dikey rail bu dilimde yok. Native TV mobil alt barı kullanmaz. Search kısayolu mevcut Canlı arama ekranına gider; birleşik tüm-katalog araması değildir.

Sonraki tek sınırlı görev: yeni kaynak APK'sı üzerinde Home→Info→Player→Back, Dialog odak ve hata çıkışının Poco/Homatics görsel/remote retesti. Kullanıcı bu dilimde final Quality sonrası Universal denemesini açıkça yetkilendirdi; her push'ta APK üretimi veya otomatik fiziksel PASS yetkisi yoktur. TMDB LIVE BLOCKED, tarihsel FAIL ve 14 legacy SKIP korunur.

---

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

Sonraki sınırlı dilim: Player ses/altyazı/görüntü oranı panellerinin Native/Preview gerçek üretim host eylem matrisi ve ortak Elite durum renkleri. Tam ekran görsel parity ayrıca açık; U4 kapatılmadı.

## U4.1 OwnTV StageRail ve Live adaptive integration — 2026-10-19

- Kaynak: OwnTV `cead977803d90bd62ece69b4140e373f01feddca`, `app/src/main/java/tv/own/owntv/features/shell/components/StageRail.kt` satır 77–86 (`HIDDEN`, `CAPSULE`, `OPEN`, `PINNED`) ve 196–201 (Focus etkisi). GPLv3 Kotlin kodu aktarılmadı; React Native davranışı bağımsızdır. OwnTV_Core `c14e944b8d17e5cbb559d116afb30dc3b34864cb` referans olarak tutulur, bu dilimde Core kodu değiştirilmez.
- Mevcut eşzamanlı kaynakta `ResponsiveContentNav.tsx` Native TV sol dikey rail, kompakt/odakla açık genişlik, aktif sekme ve fiziksel Focus ayrımı sağlar. `EliteLiveCatalog.tsx` / `eliteLiveLayout.ts` kanal öncelikli ölçülü kategori/kanal/detay panellerini ve scroll/OK kaynak kimliklerini korur. Bu üretim dosyaları eşzamanlı commit'lerden geldiği için üzerine eski blob yazılmadı.
- U4.1 test kabulü için mevcut `adaptiveNavigationScenarios.ts` yatay genişlik varsayımı yerine ölçülü StageRail sözleşmesine uygun güçlü kontrollerle düzeltildi. `tvP0ProductionRenderScenarios.mjs` gerçek navigasyon renderında `CAPSULE -> OPEN -> CAPSULE` ve aktif sekme/Focus ayrımını ölçer. Quality #1383, eski yatay `width: targetWidth` assertion'ında FAILURE; yeni #1399 (run 39174919257) sonucunu final SHA ile ayrıca doğrula.
- SOURCE/HOST kabulü Quality SUCCESS olmadan PASS değildir. Fiziksel Android FocusFinder / D-pad ve TV Box fiziksel kabulü `PENDING_RC`, önceki `Native TV Physical FAIL` ve `TMDB LIVE BLOCKED` aynen açıktır. Legacy cleanup 14 SKIP korunur. U4.2/3/4 ertelendi; Player/Back/provider resolver ve playback motoru değiştirilmedi. Merge/APK/fiziksel test yapılmaz.
