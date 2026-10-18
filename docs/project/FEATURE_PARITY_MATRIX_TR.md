# Cihaz × Ekran × Özellik — U4.3

## Güncel sunum farkı — Visible Home / TV Remote Repair

Aşağıdaki tablo bu dilimin güncel durumudur; önceki U2/U3/U4 tabloları kendi aşamalarının tarihsel kapsamıdır.

| Özellik | Telefon portre | Yatay / tablet | Native TV | TV Preview | Kabul |
|---|---|---|---|---|---|
| Featured Home | Başlık, katalog görseli/fallback, tür/yıl varsa, iki eylem | Okunur kompakt tanıtım; kısa pencerede scroll | Aynı gerçek katalog; Native #138 Hero bütçesi ve raf policy korunur | 1dp şerit yerine en az 160dp kompakt giriş | SOURCE_FIXED; host render; fiziksel retest |
| Home eylemi | Film → mevcut Info; dizi → mevcut sezon/bölüm Info | Aynı provider nesnesi ve kimlik | Aynı | Aynı | İzle de güvenli Info kapısından ilerler; iki ayrı resolver yok, Home'dan doğrudan URL üretimi yok |
| Ana gezinme | Beşli safe-area alt bar, Player/klavyede gizli | Kompakt yatay beşli bar; dikey rail yok | Mevcut D-pad üst gezinme | Mevcut sanal gezinme | Host davranış; fiziksel NOT TESTED |
| Kitaplık | Mevcut Favoriler/Geçmiş/Devam Et + İndirmeler | Aynı | Mevcut sekmeler korunur | Mevcut sekmeler korunur | Yeni özellik/indirme protokolü eklenmez |
| Kategori | Aktif kategori + aranabilir alt panel; tek seçimle kapanış | Aynı, sanallaştırma korunur | Mevcut scope ve panel; kategori isimleri aranabilir | Mevcut sanal scope; kategori Dialog'unda ayrı dock entegrasyonu açık | Provider/kategori/search/sort kimlikleri değişmez |
| Film/dizi modal | Yerel Info, hata/fallback, Back korunur | Aynı | onShow'da gerçek Dialog callback/target doğrulaması; OK bir kez | Modalın kendi dock'u ve viewport sahipliği; kapanışta alttaki viewport geri gelir | Android Dialog fiziksel retest zorunlu |
| Player hata | Kalıcı yeniden dene/kataloğa dön | Aynı | Bağımsız player-error focus scope; hata Back doğrudan çıkış | Dokunmatik hata eylemleri; Player sanal D-pad tam parity bu dilimde yok | Host test; akış hatasının network/auth/decoder nedeni bilinmiyor |
| Sezon görünürlüğü | Sabit 180dp slot ile seçili sezonu görünür yapma | Aynı | Aynı model + mevcut Native focus | Aynı | State, episode offset ve season viewport ayrı sahipler; fiziksel retest |

Üretim playback/identity/cache servisleri değiştirilmedi. TMDB dizi servisi eklenmedi. Örnek verili web incelemesi gerçek cihaz görüntüsü değildir; kullanılan üretim React Native bileşenlerinin izole web adaptasyonudur. Yeni Native ve mobil görsel kabul henüz verilmedi.

---

Bu tablo kaynak bağlantısını gösterir; Physical PASS tablosu değildir. P=telefon portrait, L=telefon landscape, T=tablet P/L, TV=Native Android TV/Google TV/Box, Preview=telefon/tablette sanal D-pad. Telefon katalog landscape, devralınan policy yüzünden hâlâ açık ürün boşluğudur; landscape Player desteğiyle karıştırılmaz.

| Ekran/özellik | Telefon P | Telefon L | Tablet P/L | Native TV | TV Preview | Kaynak / açık fark |
|---|---|---|---|---|---|---|
| Home | Responsive bounded Hero/touch | Katalog policy kısıtı | Responsive bounded Hero | Kompakt #138 Hero + raf odak politikası | Responsive bounded Hero + sanal hedefler; Native bütçe ayrı | HomeDiscovery, nativeTvHomeLayout; Elite Cinematic Luxury üretimde tamam değil |
| Live TV | Eski liste/drawer | Policy kısıtı | Eski liste/drawer | Gerçek EliteLiveCatalog; seçili/oynayan ayrı | Eski liste/drawer | PagedCatalogViews; Elite Live mobil/tablet/Preview parity açık |
| Movies/VOD | Ölçülü responsive grid → Film Info | Policy kısıtı | Ölçülü responsive grid → Film Info | Native ölçülü grid → Film Info | Ölçülü Preview grid → Film Info | #121/#126 üretime bağlı; Xtream/M3U Home→Info U4.1; Stalker Home→Info U4.2 bağlı |
| Series | Responsive Golden/provider katalog | Policy kısıtı | Ölçülü responsive Golden grid | Native hedefli katalog/season/episode | Responsive grid + sanal hedefli katalog | Yerel Series Info U4.3 bağlı; TV metadata yok |
| Film Info | Yerel öncelikli Elite modal | Modal ölçüsü responsive; katalog policy açık | Mobile layout profili | Native modal scope | Sanal scope; mobile layout profili | MovieInfoModal; matcher/proxy live kapalı; geniş cihaz profili parity açık |
| Series Info | Ortak yerel modal | Modal uyarlanır; katalog policy açık | Ortak yerel modal | Aynı series-info scope | Aynı sanal scope | U4.3: Xtream/Stalker; M3U yalnız gerçek cached hiyerarşi. TV metadata backend yok |
| Player | Aktif V2 touch | Landscape Player | V2 touch | Aynı V2 + native remote sahipliği | Handheld Player yolu | CompatibilityVideoPlayerV2; Back→panel→controls→exit politikası; yeni fiziksel kabul yok |
| Kanal overlay | Eski chrome | Eski chrome | Eski chrome | Eski chrome + native hedefler | Eski chrome | Elite overlay hedefi henüz üretim değil |
| Ayarlar | Ortak eski yüzey | Policy kısıtı | Ortak eski yüzey | Inspector dahil | Preview tercihi dahil | #131 cache-first refresh ayarları U3 üzerinden bağlı |
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

## U4.3 — güncel provider ve cihaz sözleşmesi

| Provider | Home / katalog | Gerçek veri yolu | Bölüm / ilerleme | Sınır |
|---|---|---|---|---|
| Xtream | Seçilen exact series ID → ortak Series Info | Mevcut hedefli getSeriesInfo; request AbortSignal + seçim ticket'ı | Gerçek season key/episode ID; explicit xtream-episode ref; eski progress sistemi | TV metadata yok; provider'ın vermediği alanlar boş |
| M3U | Yalnız mevcut gerçek cached seriesGroups | Hedefli tek persisted dizi hydration; Play'de güncel grup kontrolü | Gerçek mevcut episode item ID; m3u-episode ref | Hiyerarşi içermeyen playlist'e dizi desteği uydurulmaz; bulunamayan grup hata/retry |
| Stalker | Home portal series ID → mevcut targeted detail; katalog aynı shared UI | Existing movie_id hierarchy + bounded compatibility fallback; session ownership | Provider+series+season+episode ref; mevcut create_link yalnız bölüm seçiminde | Parser sunmuyorsa bölüm açıklaması/süresi gösterilmez; mevcut hierarchyTruncated sınırı korunur |

Telefon, tablet P/L, Native TV/Box ve Preview aynı Series Info modelini kullanır; kart yerleşimleri ve input yöntemi cihaza göre uyarlanır. Sezon active vurgusu, seçilmiş bölüm durumu ve beyaz Focus ayrı kalır. Player'a geçince modal gizlenir ama seçim/offset state'i yaşar; dönüşte yeniden açılır. Native fiziksel restore ve Android Modal dispatch **NOT TESTED**; host/JS/JVM testleri bunun yerine geçmez. U4.2 Film Info kaynak işi tamamdır; Stalker locator sınırı ayrı açıktır.


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

| Ekran | Kaynak/otomatik kabul | Açık sınır |
|---|---|---|
| Home | Mevcut film İzle/Bilgi ve dizi kimliği host testleri korundu | Dokunma ile fiziksel D-pad dönüş/raf viewport kabulü ayrı |
| Live | Mevcut OK kanal açma, focus/selection ayrımı, loading ve P0 host korundu | Homatics görünür liste ve gerçek Back ölçümü açık |
| Movies | Sekiz profil grid, Info/Play kimliği ve kategori/arama P1 host PASS | Tüm provider ve gerçek pencere/klavye restorasyonu PARTIAL |
| Series | Sezon/bölüm kimliği, dönüş ve provider/session stale testleri PASS | M3U gerçek hiyerarşi yoksa destek uydurulmaz |
| Film Info | Yerel veri önceliği eklendi, metadata fixture testleri PASS | Canlı TMDB BLOCKED |
| Player | Aktif PlayerChrome süre kapısı eklendi; V2 yardımcı yüzeyi sağlamlaştırıldı | Native/Preview tüm panel eylemleri ve fiziksel odak PARTIAL |

Telefon/tablet host kapsamı mobil orientation sözleşmesini değiştirmez. Native JVM Android pencere kanıtı değildir. Preview sonucu Native TV Physical PASS değildir.

## U4.1 OwnTV StageRail ve Live adaptive integration — 2026-10-19

- Kaynak: OwnTV `cead977803d90bd62ece69b4140e373f01feddca`, `app/src/main/java/tv/own/owntv/features/shell/components/StageRail.kt` satır 77–86 (`HIDDEN`, `CAPSULE`, `OPEN`, `PINNED`) ve 196–201 (Focus etkisi). GPLv3 Kotlin kodu aktarılmadı; React Native davranışı bağımsızdır. OwnTV_Core `c14e944b8d17e5cbb559d116afb30dc3b34864cb` referans olarak tutulur, bu dilimde Core kodu değiştirilmez.
- Mevcut eşzamanlı kaynakta `ResponsiveContentNav.tsx` Native TV sol dikey rail, kompakt/odakla açık genişlik, aktif sekme ve fiziksel Focus ayrımı sağlar. `EliteLiveCatalog.tsx` / `eliteLiveLayout.ts` kanal öncelikli ölçülü kategori/kanal/detay panellerini ve scroll/OK kaynak kimliklerini korur. Bu üretim dosyaları eşzamanlı commit'lerden geldiği için üzerine eski blob yazılmadı.
- U4.1 test kabulü için mevcut `adaptiveNavigationScenarios.ts` yatay genişlik varsayımı yerine ölçülü StageRail sözleşmesine uygun güçlü kontrollerle düzeltildi. `tvP0ProductionRenderScenarios.mjs` gerçek navigasyon renderında `CAPSULE -> OPEN -> CAPSULE` ve aktif sekme/Focus ayrımını ölçer. Quality #1383, eski yatay `width: targetWidth` assertion'ında FAILURE; yeni #1399 (run 39174919257) sonucunu final SHA ile ayrıca doğrula.
- SOURCE/HOST kabulü Quality SUCCESS olmadan PASS değildir. Fiziksel Android FocusFinder / D-pad ve TV Box fiziksel kabulü `PENDING_RC`, önceki `Native TV Physical FAIL` ve `TMDB LIVE BLOCKED` aynen açıktır. Legacy cleanup 14 SKIP korunur. U4.2/3/4 ertelendi; Player/Back/provider resolver ve playback motoru değiştirilmedi. Merge/APK/fiziksel test yapılmaz.

## U4.1 OwnTV SOURCE-GUIDED TV rail + Live adaptive — 2026-10-19 final source gate

- OwnTV kaynak kanıtı: `ahXN00/OwnTV@cead977803d90bd62ece69b4140e373f01feddca`, `app/src/main/java/tv/own/owntv/features/shell/components/StageRail.kt` (77–85 RailState, 196–208 Focus); `features/live/LiveScreen.kt` (561–609 ölçülen panel payları); `ui/components/FocusTrap.kt` (24–29 / 66–82). Core: `ahXN00/OwnTV_Core@c14e944b8d17e5cbb559d116afb30dc3b34864cb`, `core/src/main/java/tv/own/owntv/core/content/SearchReader.kt` (28–55 / 100–140). GPLv3 Kotlin/Compose kodu taşınmadı.
- **IMPLEMENTED (kapsamlı olmayan U4.1 dilimi):** `ResponsiveContentNav.tsx` Native TV için bağımsız kompakt ikon / Focus ile açık dikey rail; mobil tablar ve TV Preview mevcut davranışları korunur. `OptimizedHomeScreenPaged.tsx` rail alanını içerik viewport'undan ayırır; Hero'yu dikey itmez. `FocusButton.tsx` kompakt ikonlarda erişilebilir konuşma etiketini ve fiziksel beyaz Focus çerçevesini korur. `eliteLiveLayout.ts` + `EliteLiveCatalog.tsx` ölçülen dp alanında kanal listesi lehine panel bütçesini sınırlar, kanal OK -> mevcut onOpen kimliği ve kategori/kanal Focus ayrımı korunur.
- **SOURCE/HOST PASS:** `tests/u41StageRailLiveHostScenarios.mjs` gerçek Native rail / Live kaynaklarını esbuild ile iki TV viewport'unda (720×480, 1920×1080), ayrıca Preview ve mobil ayrımında sınar: compact/open/compact, dört nav Focus kimliği ve callback'i, kategorilerin seçimi, kanal scrollIntoView, Focus sırasında oynatmama ve OK ile açma, detay paneli genişliği. `quality.yml` gate eklendi; mevcut P0/P1 testleri değiştirilmedi. Exact kod SHA `7a1e755f3b2b59ea505fb39604a3f24acc480866`: Quality #1407 run `39175271837` **SUCCESS**, başarısız adım yok. Son belge commit SHA'sında ayrıca Quality şarttır.
- **PARTIAL / DEFERRED:** U4.1 Native fiziksel FocusFinder, önceki içerik Focus kimliğine açıkça geri yönlendirme, HIDDEN/PINNED rail modları ve TV Preview'da aynı sol rail henüz tam kabul değildir. U4.2 katlanan Hero, U4.3 provider-scope Focus+scroll restorasyonu, U4.4 birleşik SearchReader semantiği ve controlled zapping **DEFERRED**. Xtream/M3U/Stalker resolver/session, Player/Back, TMDB ve cache sözleşmeleri değiştirilmedi.
- **PHYSICAL PENDING / DEFERRED_RC:** Native TV Physical FAIL geçmişi ve TMDB LIVE BLOCKED açık. Quality otomatik kaynak kabulüdür, fiziksel PASS değildir. Bu dilimde APK, merge veya fiziksel cihaz testi yapılmadı.
