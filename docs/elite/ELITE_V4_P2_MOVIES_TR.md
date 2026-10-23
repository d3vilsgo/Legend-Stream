# Elite V4 P2 Movies teslim kaydı


## Elite V4 P2 Movies — 23 Ekim 2026

Başlangıç `56dfe7b13a7db5ad0760595fb310489e08ec1263`; PR #143, integration/legendstream-u1, base ve OPEN/DRAFT korunur. Bağımsız V4 Movies ekranı Sidebar'a bağlandı; Home/P0/P1 ve Live yolları korunur.

Provider kapsamı: Xtream/M3U mevcut useCatalogPage(kind=vod), kategori deposu ve gerçek provider DTO'ları; kategori/arama/sıralama tam önbellek sorgusunda uygulanır. Son eklenen yalnız Xtream'de sunulur. Stalker mevcut useStalkerMoviesCatalog ve mevcut session/create_link yolu; gerçek provider kategorileri ve arama korunur. Stalker alfabetik sıralama yüklenen filmlerle sınırlıdır ve ekranda açıklanır; totalItems bilinmiyorsa terminal sayfa kararı mevcut hook'un bounded loadMore korumasındadır. Eksik portal/MAC ve oturum hataları güvenli V4 durumuyla bildirilir. Global Stalker sıralama iddiası yoktur.

Hero yalnız provider filmini mevcut Movie Info servisiyle zenginleştirir; TMDB sonuçları oynatılabilir kataloğa eklenmez. Metadata gelmezse provider bilgisi gösterilir. Hero ekran yüksekliğinin %30'u (164–280 dp minHeight), doğal metin akışı; TV grid en fazla 6 sütun, en az 176 dp hedef, büyük yazıda sütun azalması ve 18 sp başlık kullanır. Grid/kategori focus reveal, Sidebar→Movies→Hero→Kategori→Grid, Grid→Hero/Sidebar ve Info→aynı kart dönüşü bağlandı. Arama Back ile kapanır; ikinci Back Home'a döner; modal/Player kendi Back sahipliğini korur. Yeni V4 oturum hatası yüzeyinde de Back bulunur.

Film seçimi mevcut MovieInfoModal'a gider; Play son provider DTO'sunu kullanır, eski query callback'i reddedilir. Ortak modal yalnız optional focusVisualStyle alanıyla genişletildi: V4 1 dp Focus, V3 varsayılanı aynı. V3 ekranları, TMDB Direct API, Live TV/EPG ve Player/provider servisleri değiştirilmedi; GEN2 incelenmedi. Shell yalnız V4 Movies route ve Stalker playable adaptörünü ekler.

Yerel üretim testleri: Movies 14/14 (gerçek component render, adapter, grid/focus/scroll, Movie Info sözleşmesi, mevcut resolver handoff ve stale query/route), mevcut V4 18/18, Live 14/14, ortak Home Movie Info 15/15; TypeScript ve hedefli Prettier PASS. Yeni Movies host mevcut Quality V4 girişinden çalışır; Live host yalnız yeni Movies sınırını stub'lar, Live assertions değişmedi. Assertion gevşetme/skip yok. Final exact-SHA Quality run logundan doğrulanacak; bu kaynak kaydı gelecekteki run sonucunu PASS saymaz.

APK ÜRETİMİ YOK: Android APK workflow'una yalnız [skip apk] işaretli branch push'unda build job'u atlayan koşul eklendi; Quality etkilenmez, manuel/tag derlemeleri korunur. Bu görevin commit'leri [skip apk] taşır. Series tamamlanmadan bütünleşik Universal APK başlatılmaz. Önceki APK #530 P2 Movies'i içermez.

Açık sınırlar: Stalker'ın yüklenen alt kümede sıralaması ve totalItems=null terminal UI belirsizliği; gerçek sağlayıcı/cihaz ve Android FocusFinder kabulü NOT TESTED / DEFERRED_RC. Gerçek ekran görüntüsü yok; host geometri testi fiziksel PASS değildir. V4 Series/Continue Watching/Settings ve Stalker Live ayrı sonraki işlerdir; genel parity PARTIAL. P0 kullanıcı kabulü ve tarihsel Native TV Physical FAIL kayıtları korunur.
