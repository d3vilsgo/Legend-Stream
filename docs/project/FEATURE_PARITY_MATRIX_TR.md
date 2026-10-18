# Cihaz × Ekran × Özellik — U4.2

Bu tablo kaynak bağlantısını gösterir; Physical PASS tablosu değildir. P=telefon portrait, L=telefon landscape, T=tablet P/L, TV=Native Android TV/Google TV/Box, Preview=telefon/tablette sanal D-pad. Telefon katalog landscape, devralınan policy yüzünden hâlâ açık ürün boşluğudur; landscape Player desteğiyle karıştırılmaz.

| Ekran/özellik | Telefon P | Telefon L | Tablet P/L | Native TV | TV Preview | Kaynak / açık fark |
|---|---|---|---|---|---|---|
| Home | Responsive bounded Hero/touch | Katalog policy kısıtı | Responsive bounded Hero | Kompakt #138 Hero + raf odak politikası | Responsive bounded Hero + sanal hedefler; Native bütçe ayrı | HomeDiscovery, nativeTvHomeLayout; Elite Cinematic Luxury üretimde tamam değil |
| Live TV | Eski liste/drawer | Policy kısıtı | Eski liste/drawer | Gerçek EliteLiveCatalog; seçili/oynayan ayrı | Eski liste/drawer | PagedCatalogViews; Elite Live mobil/tablet/Preview parity açık |
| Movies/VOD | Ölçülü responsive grid → Film Info | Policy kısıtı | Ölçülü responsive grid → Film Info | Native ölçülü grid → Film Info | Ölçülü Preview grid → Film Info | #121/#126 üretime bağlı; Xtream/M3U Home→Info U4.1; Stalker Home→Info U4.2 Info açık |
| Series | Responsive Golden/provider katalog | Policy kısıtı | Ölçülü responsive Golden grid | Native hedefli katalog/season/episode | Responsive grid + sanal hedefli katalog | Series Info Elite/TMDB entegrasyonu yok |
| Film Info | Yerel öncelikli Elite modal | Modal ölçüsü responsive; katalog policy açık | Mobile layout profili | Native modal scope | Sanal scope; mobile layout profili | MovieInfoModal; matcher/proxy live kapalı; geniş cihaz profili parity açık |
| Series Info | Eski detay | Policy kısıtı | Eski detay | Eski detay | Eski detay | TMDB series DTO gerçek Series Info ekranı değildir |
| Player | Aktif V2 touch | Landscape Player | V2 touch | Aynı V2 + native remote sahipliği | Handheld Player yolu | CompatibilityVideoPlayerV2; Back→panel→controls→exit politikası; yeni fiziksel kabul yok |
| Kanal overlay | Eski chrome | Eski chrome | Eski chrome | Eski chrome + native hedefler | Eski chrome | Elite overlay hedefi henüz üretim değil |
| Ayarlar | Ortak eski yüzey | Policy kısıtı | Ortak eski yüzey | Inspector dahil | Preview tercihi dahil | #131 refresh policy ayarları bu dilimde yok |
| Favoriler | Live/history kimlikleri | Aynı veri yolu | Aynı veri yolu | Elite Live favorite + history | Eski Live/history | Bütün film/dizi favori parity tamamlanmış sayılmaz |
| Devam Et | Home + MediaLibrary | Aynı veri yolu | Aynı veri yolu | Home + native odak | Home + sanal odak | mediaProgress provider-scoped; gerçek Player dönüşü RC kabulü bekler |
| Son İzlenenler | Home/history | Aynı veri yolu | Aynı veri yolu | Home/history | Home/history | liveHistory provider kapsamı korunur |
| Arama | Katalog bazlı/touch | Policy kısıtı | Katalog bazlı | Elite Live TextInput ve eski diğer kataloglar | Eski katalog arama | Global ortak arama ve TV IME fiziksel kabulü yok |
| Provider seç/değiştir | PlayerContext + ProductShell | Policy kısıtı | Aynı sahiplik | Aynı sahiplik + remote | Aynı sahiplik + Preview | Xtream/M3U/Stalker ayrı; generation/identity guards korunur |

## Otomatik doğrulama ile fiziksel kabulün ayrımı

| Alan | Çalıştırılan kapı | Kanıtın sınırı |
|---|---|---|
| Native Home geometri/ilk raf | nativeTvHomeLayoutScenarios, nativeTvHomeRenderScenarios, JVM TvHomeReachabilityScenarios | dp hesapları + host render + Java policy; gerçek Android layout/firmware kabulü değil |
| Native bölgeler/Film Info/Elite birleşimi | JVM TvFocusPolicyScenarios içindeki U1 senaryoları | Gerçek production Java policy; Android Dialog event dağıtım testi değil |
| Back/Player/Inspector | nativeTvRemoteScenarios, nativeTvExitScenarios, tvRemoteInspectorScenarios, nativeTvFocusJvmScenarios | Saf davranış/source sözleşmeleri; fiziksel Back/scroll restorasyonu NOT TESTED |
| Telefon/tablet/orientation | uiPresentationScenarios, devicePresentationScenarios, presentationLifecycleScenarios, tabletDesignFoundationScenarios, adaptiveNavigationScenarios | Policy/model; fiziksel rotation ve scroll restorasyonu değil |
| Preview | tvPreviewScenarios | Sanal controller; Native Android focus kanıtı değil |
| Elite/Film Info/TMDB | eliteLiveLayoutScenarios, eliteDesignScenarios, tmdbMovieInfoScenarios, tmdbFoundationScenarios, tmdbSecureProxyScenarios, proxyHttp.test | Yerel/mock/HTTP boundary; TMDB LIVE BLOCKED |
| Provider/playback/identity | Quality içindeki mevcut katalog, Stalker, M3U, Xtream, progress/history/switch kapıları | Test transport/fixture; gerçek provider playback PASS değildir |

Quality sonucu, bu commit'i checkout eden GitHub run/check kaydından okunur; branch adı veya eski yeşil run yeni HEAD için geçerli sayılmaz. Geçerli otomatik ve fiziksel durumlar [kabul defterinde](RELEASE_ACCEPTANCE_TR.md) ayrı izlenir.

## U2 kaynak ve otomatik kapsam

| Özellik | Telefon P / L | Tablet P / L | Native TV / Box | TV Preview | Kabul sınırı |
|---|---|---|---|---|---|
| Poster grid yoğunluğu | Ortak profil; L geometri hesaplanır, katalog portrait kilidi korunur | Gerçek ölçülen list width, dp/safe-area/fontScale | Mevcut nativeTvLayout + useNativeTvCatalogGrid | TV sunum profili; fiziksel telefon/tablet kimliği korunur | Geometri modeli; gerçek font layout NOT TESTED |
| Sütun remount | İlk görünür provider içerik ID'sinden yeni row; dokunma focus üretmez | Aynı anchor yöntemi | Mevcut nativeFocusedId/row restore sahibi değişmez | Odaktaki ID → row → görünürlük/scope kontrollü sanal restore | Host hook; Android scroll/focus kabulü NOT TESTED |
| Scope değişimi | Provider/kategori/arama/sort değişince eski anchor iptal | Aynı | Mevcut Native yol | Modal scope ve viewport dışı hedef restore edilmez | Fixture/controller testleri; tam UI event akışı değil |
| Home Hero | Aynı helper: image/empty/loading; kısa ekranda bounded | Tablet P/L profil + ölçülen viewport | #138 bütçe/ilk raf ve JVM grafiği korunur | Kısa Hero, autoplay kapalı, sanal hedefler korunur | Host render; gerçek raf görünürlüğü RC'de |
| Home raf önceliği | Yatay viewport'ta sayaçlar raflardan sonra | Yatayda raflar önce | Mevcut raflar önce | Raflar önce | Kaynak bağlantısı; physical NOT TESTED |
| Navigasyon | #133 kompakt dokunmatik; aktif sekme accessible selected | 48dp hedef, tablet profili | FocusButton + gerçek native scope/Back sahibi | Sanal D-pad; native olmayan olay yolu | Elite semantic token yalnız kompakt sekme/kart odak yüzeyinde; tüm ürün dönüşümü değil |
| Player/Back/orientation | Mevcut policy ve geçici Player sahipliği değişmedi | Serbest tablet policy değişmedi | Native panel/controls/exit sırası değişmedi | Mevcut Preview Back yolu | Mevcut otomatik testler; fiziksel kabul yok |

Üç katalog yolu aynı helper'a bağlıdır; Xtream/M3U/Stalker katalog, bölüm ve playback kimlikleri dönüştürülmez. Grid'deki `providerId` sadece restorasyon scope'udur. TMDB ID ile playback yapılmaz. Series Info, Home→Film Info, mobil/Preview Elite Live ve Elite Home/Player/overlay hâlâ açık ürün işleridir.

## U3 ortak veri/performance sözleşmesi

| Alan | Telefon P/L | Tablet P/L | Native TV/Box | TV Preview | Sınır |
|---|---|---|---|---|---|
| Warm katalog | Kullanılabilir SQLite cache önce | Aynı | Aynı | Aynı | Fiziksel hız ölçülmedi; telefon portrait policy değişmedi |
| Otomatik refresh | Ortak 24/72 saat politika | Aynı | Aynı | Aynı | TTL silme süresi değildir; hata cache'i silmez |
| Ayarlar/tanılama | Ortak CatalogRefreshSettings/PerformanceDiagnosticsPanel | Aynı | FocusButton ile aynı kontrol | Sanal hedeflerle aynı kontrol | İki ürün shell'i de ortak bileşeni kullanır |
| Provider switch | Provider+generation ve request ownership | Aynı | Aynı | Aynı | M3U ağ isteğinde fiziksel abort eklenmedi; geç yanıt ve queued/transaction yayın iptali var |
| Paged grid yenileme | Mevcut pencere tutulur, sonuç tek yayında değişir | Aynı | Native Focus hook'u korunur | Scope/focus controller korunur | Model/host testi; gerçek Android scroll/selection/focus kabulü NOT TESTED |
| Performans olayları | Ortak runtime, RAM'de bounded kayıt | Aynı | Aynı | Aynı | Callback/React commit zamanları; fiziksel performans PASS değildir |

Provider kapsamı: Xtream Live/VOD/Series ayrı başarı/retained-cache semantiğini korur. M3U staged tam katalog değişimi ve kalıcı referanslar korunur. Stalker otomatik politika **Live** içindir; VOD/Series session/page/lazy yolları aynı kalır. Stalker EPG probu üretim EPG özelliği sayılmaz. EPG'nin mevcut bağımsız freshness/iptal sistemi katalog 24/72 saat politikasına çevrilmez.

Home Hero, adaptive navigation, Native Focus/Hero/Inspector, Player Back/orientation, Elite Live ve Film Info üretim davranışları U2 tabanından korunur. Tam Elite marka/ekran parity bu veri katmanı entegrasyonuyla tamamlanmaz.

## U4.1 Home → Film Info eylem matrisi — tarihsel; U4.2 güncellemesi aşağıda

| Provider / eylem | Telefon portrait | Telefon landscape | Tablet P/L | Native TV/Box | TV Preview | Kabul |
|---|---|---|---|---|---|---|
| Xtream/M3U Home film → Info | Ortak modal | Modal responsive; katalog orientation boşluğu sürer | Ortak modal | Aynı modal/native scope | Aynı modal/sanal scope | SOURCE_CONNECTED; host hook testi; fiziksel NOT TESTED |
| Info → İzle → Back | Provider resolver → Home | Mevcut Player orientation | Mevcut Player yolu → Home | Mevcut Player/Back → Home | Mevcut Player yolu → Home | Kaynak sözleşmesi; gerçek cihaz restorasyonu DEFERRED_RC |
| Stalker Home film | Movies sekmesi | Movies sekmesi | Movies sekmesi | Movies sekmesi | Movies sekmesi | DEFERRED; seçilen filme doğrudan Info parity eksik |

Home yenilenirken modal aynı kimlik için yeni sunum nesnesini kullanır; film snapshot'tan kalkarsa kapanır. TMDB kimliği playback kimliği olmaz. Bu kayıt tam Elite Home tasarımı, Series Info veya bütün cihazlarda görsel kabul anlamına gelmez.

## U4.2 güncel eylem parity (önceki U4.1 Stalker boşluğunu günceller)

| Kaynak / profil | Home film → Info | İzle / dönüş | Odak ve konum | Kabul |
|---|---|---|---|---|
| Stalker / telefon P-L | Aynı portal kimliği, ortak modal, yerel fallback | Güncel session bounded page → mevcut resolver → Home | Home bağlı; scroll ve Hero durdurulur | SOURCE_CONNECTED; host/service PASS, fiziksel NOT TESTED |
| Stalker / tablet P-L | Aynı shared modal; genişliğe uyarlanır | Aynı kimlik ve resolver | Aynı Home sürekliliği | SOURCE_CONNECTED; gerçek orientation/konum RC |
| Stalker / Native TV/Box | Aynı shared modal/native movie-info scope | Home kökeni Home; Movies kökeni Movies | Back ilk hedef; eski Native scope restore sahibi korunur | Kaynak/JVM regresyonu; tarihsel Physical FAIL kapanmaz |
| Stalker / TV Preview | Aynı Info + sanal scope/Back | Aynı portal/session doğrulaması | JS scope kapanınca seçilen Home hedefini geri alır | Host Preview controller PASS; fiziksel NOT TESTED |
| Xtream/M3U | U4.1 yolu korunur | Mevcut resolver ve dönüşler | Yeni Stalker async Play seçeneği bunların varsayılanını değiştirmez | Mevcut regresyon kapıları |
| Bütün provider'lar / Series Info | Home exact-item ve ortak Elite detay parity eksik | Mevcut katalog sezon/bölüm resolver'ları ayrı | Home/katalog kökeni ve hata/restorasyon U4.3 | OPEN / DEFERRED_U4.3 |

Stalker Yeni Filmler rafı bugün yok (`newMovies=[]`). Home toplamları ve Continue Watching ayrı akışlar olarak korunur. Bu dilim tam Elite görsel dönüşümü, kapsamlı Series Info veya fiziksel kumanda kabulü değildir.
