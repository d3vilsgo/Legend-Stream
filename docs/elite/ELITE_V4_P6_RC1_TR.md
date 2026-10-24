# Elite V4 P6 — Stalker Live ve uçtan uca RC1

Başlangıç SHA: `6f1cf2250b694121dbcdc664e78a50b889909926`.
PR #143 OPEN/DRAFT; branch `integration/legendstream-u1`; base `feature/r19-tmdb-secure-proxy`.
Final kaynak, Quality ve APK run bilgileri teslim mesajında ve APK içeren artifact'in `rc1-build-manifest.json` dosyasında doğrulanır. APK SUCCESS ve erişim doğrulanmadan bu belge tek başına RC1 teslim kabulü değildir.

## Kaynak ve korunan kapsam

Başlangıç Quality #1636 SUCCESS 99/99 ve remote HEAD eşleşmesi doğrulandı. Kurtarılmış git/dependency ortamı kullanılabildi. Yeni branch, PR, merge veya backend yoktur. P0–P5 korunur; V3 ekranları, provider motorları, canonical Player ve TMDB Direct HTTPS yeniden yazılmaz. Yeni History/Favorites/Settings deposu oluşturulmaz. Gerçek kullanıcı hesabı/geçmiş/favori kaydı silinmez.

## Uygulanan Stalker Live akışı

Mevcut Stalker oturumu → gerçek cache kategorileri → mevcut useCatalogPage/Stalker lazy paging → provider kapsamlı EPG → resolveCatalogRuntimeSource → mevcut NativeVideoPlayer → mevcut P4 geçmiş/favori kayıtları → kaynak kanal odağı.

V4 Sidebar artık Stalker için Live ekranını açar. Mevcut lazy ordered-list, global kategori/get_all_channels uyumluluk, pagination ve runtime locator mekanizmaları kullanılır. Ham portal cmd veya kalıcı eski transport URL üzerinden ikinci bir oynatma yolu oluşturulmaz.

Kategoriler ve arama provider/kategori kimliğiyle sorgulanır; kanal verileri Home'un sınırlı örneklerinden türetilmez. Kategori yenilemesi tek işlemle korunur. Eski provider/ekranın tamamlanan yenilemesi yeni ekrana veri yayımlayamaz. Kategori, arama veya ekran aktifliği değişiminde eski görünüm callback'leri oynatma/favori/sayfalama başlatamaz.

Kanal EPG seed'leri mevcut registry'ye sınırlı sayıda kaydedilir. Odaklanan gerçek kanal öne alınır ve hızlı D-pad hareketleri kısa debounce ile mevcut EPG retry/single-flight politikalarına bağlanır. Şimdi/Sonraki başlığı ve gerçek zaman aralığı gösterilir; eksik EPG için metin fallback vardır. Program veya zaman uydurulmaz.

## Ortak V4 Live sunumu

Geniş ve yeterli yükseklikteki ekranda kategori, kanal ve EPG/aksiyon panelleri yan yana yer alır. Dar ekranlarda kategori şeridi ve uyarlanmış kanal/EPG düzeni korunur. Kategori ve kanal odağı kaydırılır. İnce turkuaz mevcut Focus kullanılır. Önizleme yalnız metadata/EPG'dir; ikinci oynatma oturumu açılmaz.

Native hızlı odak hareketlerinde eski kanalın OK veya eski EPG aksiyonu yeni seçimi yanlışlıkla oynatamaz. Favori işlemi gerçek persistence tamamlanana kadar tekrar OK'ya karşı kilitlenir.

## Player/session düzeltmeleri

Stalker Live, Home ve History/Favorites kanal seçimleri mevcut canonical runtime resolver'a bağlanır. Gerçek portal kimliğinden güncel cmd yeniden alınır; gerektiğinde create_link mevcut oturumda çözülür. HTTP/HTTPS ve mevcut VLC uyumlu RTSP/RTMP kaynakları korunur; çözümlenmemiş cmd Player'a aktarılmaz.

Shell tek açılış kilidiyle çift OK'yı engeller. Navigation/provider değişimi pending resolver'ı iptal eder. Aynı hesap ID'sinin yeni yapılandırması bile eski kaynak callback'ini reddeder. Oturum sahipliği kontrolü artık read-only registry sorgusudur; kapanmış oturum kontrol sırasında yeniden oluşturulmaz. Mevcut portal auth yenileme/bounded retry davranışı korunur.

Player çıkış callback'i kendi playback nesnesinin hâlâ aktif olduğunu doğrular. Eski Player'dan gelen gecikmiş ikinci çıkış, yeni açılmış Player'ı kapatamaz. Focus restorasyonu yeni Player veya yeni route arkasına sızmaz. Library/Series modal sahipliği korunur.

Home film rafı gerçek provider Movie Info'ya açılır; Hero'nun oynat aksiyonu korunur. Home rafları açık origin Focus kimliğini taşır; dokunmatik Player dönüşü de doğru karta gelir. Live Player dönüşü ilgili kanal kimliğine yapılır. Series sezon/bölüm ve resume mevcut P3/P4 yollarını kullanır.

## Destek matrisi ve portal sınırları

| Alan | Xtream | M3U | Stalker |
| --- | --- | --- | --- |
| Live kategori/kanal | Mevcut gerçek katalog | Gerçek playlist grupları | Gerçek portal kategorileri ve lazy sayfalar |
| Arama/sıralama | Mevcut katalog yetenekleri | Mevcut cache/playlist yetenekleri | Arama yalnız yüklenmiş cache; provider sırası, evrensel sunucu araması iddiası yok |
| EPG | Mevcut API/XMLTV | Sağlanan gerçek EPG kaynağı | Portalın sunduğu ve doğru kanala eşleşen veriler |
| Oynatma | Mevcut canonical yol | Gerçek URL/resolver | Runtime identity → güncel cmd → gerekirse create_link |
| Movies/Series | P2/P3 kapsamı | Gerçek mevcut gruplama ve episode URL'leri | Mevcut VOD/Series ve gerçek season/episode kimlikleri |
| History/Favorites/Resume | Provider/account kapsamında | Provider/account kapsamında | Aynı P4 sözleşmesi; Live için medya yüzdesi yok |
| Settings | Mevcut P5 kontrolleri | Mevcut P5 kontrolleri | Mevcut P5 ve portal yetenek sınırları |

Portalların genre/genre_id dialect'i, global kategori, sayfalama, EPG ve create_link yanıtları aynı kabul edilmez. Mevcut doğrulama/uyumluluk sınırları korunur. Desteklenmeyen portal davranışı için sahte katalog, EPG, program, stream veya sıralama oluşturulmaz.

P4'ün eski parent kimliği eksik episode kayıtları, P5'in çevrilmemiş V4 metinleri ve mevcut olmayan global ses/altyazı/EPG zaman kayması/cache temizleme ayar sınırları değişmez. Gerçek portal ağ kabulü otomatik host testinden çıkarılamaz.

## Test kanıtı

P6 yeni kapsamı 38 senaryo:
- Live üretim host'una 19 ek senaryo (toplam 33/33).
- Library/Home entegrasyonuna 3 ek senaryo (toplam 24/24).
- Gerçek canonical runtime/portal oturumu 10/10; yalnız fetch ve native sınırları test verisidir.
- Workflow'un gerçek manifest oluşturma koduyla artifact sözleşmesi 6/6; bu fixture ZIP testi gerçek APK imza kabulü değildir.

V4 üretim host grubunda Home/Sidebar 19, Live 33, Movies 14, Series 22, P4 persistence 19, Library 24, Settings 25 ve Stalker runtime 10: toplam 166/166.

Seçili ürün/persistence/Focus grubu 392 senaryodur; bunlara Player/Home 21, U4.3 Series 40, episode history/resume 41, media progress 31, Live history 32, UI presentation 23, TV Preview 32 ve artifact sözleşmesi 6 dahildir. Ayrıca mevcut test:catalog-parity paketinin bütün Stalker protocol/live/R17/category/History-Favorites alt testleri, provider-switch ve live queue testleri çalıştırılır. Test assertion'ları kaldırılmaz; eski yatay kategori beklentisi yeni dikey panelin gerçek ölçülmüş Y kaydırmasını doğrulayacak şekilde güncellenir.

Workspace/app/API/scripts TypeScript, V4/helper/test formatı ve git whitespace kapıları uygulanır. Quality eski SHA'ya dayanmaz; APK da aynı final SHA'yı bekler.

## Universal APK üretim ve doğrulama sözleşmesi

Mevcut Android APK workflow'u `[universal]` push işaretini kullanır. İlk gate aynı SHA'nın pull_request Quality sonucunu bekler; başarısız/eksik Quality derlemeyi engeller. Yeni workflow veya backend yoktur.

Mevcut aapt/apksigner kontrolü uygulama kimliği, versionCode, imza ve beklenen sertifikayı fail-closed doğrular. Her iki ABI'de libvlc.so, libvlcjni.so ve libc++_shared.so zorunludur. Artifact içerir:
- Universal APK.
- APK SHA-256 dosyası.
- `rc1-build-manifest.json`: dosya adı, byte boyutu, APK SHA-256, ABI'ler, doğrulanan paket/versionCode/sertifika, full kaynak commit ve build run ID.

GitHub artifact ZIP digest'i ile içindeki APK SHA-256 farklı değerlerdir; raporda APK özeti kullanılır. APK artifact'i gerçekten indirilebilir olmadan RC1 tamamlandı denmez.

## Fiziksel kabul planı

Durum: **DEFERRED_RC**. Otomatik testler Homatics/Poco fiziksel PASS değildir.

1. İmzalı Universal APK'yı mevcut uygulamanın üzerine kurma; hesap/geçmiş/favorilerin korunması.
2. V3 varsayılanı ve V4'e açık geçiş; Sidebar LEFT/RIGHT/UP/DOWN/BACK.
3. Gerçek Stalker hesabında All/kategori, uzun kanal listesi, yükleme/hata/boş durumları ve cache araması.
4. Gerçek Şimdi/Sonraki EPG eşleşmesi; olmayan EPG fallback'i; manuel yenileme.
5. Hızlı D-pad/çift OK; tek Player; kanal değiştirme ve BACK'te doğru kanal/kategori odağı.
6. Home/Movie Info/Series sezon-bölüm/Player dönüşü; doğru bölüm ve resume.
7. History/Favorites yeniden başlatma, hesap değişimi ve farklı portal kimliklerinin ayrılığı.
8. Settings kontrol süresi/decoder tercihi; yeniden Player açılışında etkisi; güvenli onay/iptal.
9. Telefon/tablette touch, arama/klavye, dikey-yatay Hero/grid ve Player dönüşü.

## Değişen dosyalar

- `.github/workflows/android-apk.yml`
- `.github/workflows/quality.yml`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4ContentRail.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4Home.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4LiveCatalog.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4TvShell.tsx`
- `artifacts/legendstream-xplayer/lib/stalkerProductSession.ts`
- `artifacts/legendstream-xplayer/tests/androidTvUniversalBuildScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4LibraryProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4LiveProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4MoviesProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4ProductionHostScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4RcArtifactScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4SeriesProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4StalkerRuntimeScenarios.mjs`
- `docs/elite/ELITE_V4_P6_RC1_TR.md`

- `docs/project/FEATURE_PARITY_MATRIX_TR.md`
- `docs/project/INTEGRATION_LEDGER_TR.md`
- `docs/project/OPEN_ISSUES_TR.md`
- `docs/project/PRODUCT_ROADMAP_TR.md`
- `docs/project/RELEASE_ACCEPTANCE_TR.md`
