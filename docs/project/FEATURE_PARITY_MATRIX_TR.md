# Cihaz × Ekran × Özellik — U1.1

Bu tablo kaynak bağlantısını gösterir; Physical PASS tablosu değildir. P=telefon portrait, L=telefon landscape, T=tablet P/L, TV=Native Android TV/Google TV/Box, Preview=telefon/tablette sanal D-pad. Telefon katalog landscape, devralınan policy yüzünden hâlâ açık ürün boşluğudur; landscape Player desteğiyle karıştırılmaz.

| Ekran/özellik | Telefon P | Telefon L | Tablet P/L | Native TV | TV Preview | Kaynak / açık fark |
|---|---|---|---|---|---|---|
| Home | Eski HomeDiscovery/touch | Katalog policy kısıtı | Eski HomeDiscovery | Kompakt #138 Hero + raf odak politikası | Eski Home + sanal hedefler; Native geometri uygulanmaz | HomeDiscovery, nativeTvHomeLayout; Elite Cinematic Luxury üretimde tamam değil |
| Live TV | Eski liste/drawer | Policy kısıtı | Eski liste/drawer | Gerçek EliteLiveCatalog; seçili/oynayan ayrı | Eski liste/drawer | PagedCatalogViews; Elite Live mobil/tablet/Preview parity açık |
| Movies/VOD | Grid → Film Info | Policy kısıtı | Eşik grid → Film Info | Native ölçülü grid → Film Info | Preview grid → Film Info | #126 gerçek premium grid bağlantısı ve Home entry point parity açık |
| Series | Golden/provider katalog | Policy kısıtı | Katalog/genişlik eşikleri | Native hedefli katalog/season/episode | Sanal hedefli katalog | Series Info Elite/TMDB entegrasyonu yok |
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
