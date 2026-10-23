# Elite V4 P4 — İzleme Geçmişi, Devam Et ve Favoriler

Başlangıç SHA: `36c132e8434738a87e823b550f96f871a0e2e19d`.
PR #143: OPEN/DRAFT; branch `integration/legendstream-u1`; base `feature/r19-tmdb-secure-proxy`.
Final SHA ve Quality run bağlantısı, bu raporu içeren commit için Actions sonucunda ve teslim mesajında doğrulanır. Eski #1630 sonucu bu değişiklikler için PASS sayılmaz.

## Uygulanan ürün akışı

Provider içeriği → mevcut Player/VLC olayları → mevcut kalıcı kayıt → reaktif V4 ekranları → aktif provider resolver → mevcut Player/resume.

Sidebar History ve Favorites artık V4 içinde açılır. İki görünüm Canlı TV/Film/Dizi filtreleri, sanallaştırılmış responsive kart satırları, detay/oynatma/kaldırma aksiyonları kullanır. Home Continue Watching gerçek kayıtları zaman sırasıyla gösterir; diziler gerçek parent kimliğine göre gruplanır. Boş raf gizlenir. Kartlarda ince turkuaz Focus ve dokunmatik aksiyonlar vardır. Modal kapsamı arka plan odağını kapatır; Player dönüşünde ilgili ekran/öğe korunur.

Home, Movies ve Series kartları ile film/dizi detaylarından aynı favori kaydı değiştirilir. Live TV mevcut kanal favori ve playback yolunu kullanır. Kanal geçmişinde logo ve varsa güncel EPG gösterilir; canlı yayına yüzde ilerleme eklenmez.

## Persistence ve geriye uyumluluk

İkinci bir geçmiş/favori deposu oluşturulmadı:
- Mevcut PlayerState `player-state-v3`: eski kanal `favorites` listesi korunur; isteğe bağlı `mediaFavorites` alanı eklenir.
- Mevcut `@legendstream/live-history-v2`: provider kanal listeleri korunur; yalnız yeni gerçek izlemelerde isteğe bağlı zaman bilgisi yazılır.
- Mevcut `@legendstream/media-progress-v2`: canonical provider/playbackRef kayıtları kullanılır; gerçek bölüm parent/sezon/numarası isteğe bağlı `episodeContext` alanına eklenir. V1 migration korunur.

Tamamlanmış yeni medya kayıtları History için korunur. V3'e sunulan eski `entries` projeksiyonu son 30 saniye kuralını korur. V4 Continue Watching ayrıca %95 tamamlanma sınırı uygular. Konum >5 saniye, sonlu pozitif süre ve konum/süre tutarlılığı zorunludur. Unresolved kaynaklar veya gerçek parent kimliği olmayan eski bölümler için çalışmayan resume sunulmaz.

Yazmalar mevcut anahtarlar üzerinde sıraya alınır; kalıcı yazma sonrası geri okuma doğrulanır. Başarısızlık ekranda görünür; doğrulanmış bellek durumu korunur. Hatalı hydration mevcut verinin üzerine yazmayı engeller ve yeniden deneme sunar. Uygulama yeniden açılışı gerçek context testlerinde doğrulanır.

## Hesap izolasyonu ve playback

Film/dizi favori anahtarı provider/account ID + içerik türü + gerçek katalog ID'dir. Kanal kimlikleri mevcut provider önekini korur. TMDB kimliği veya başlıkla tekilleştirme yapılmaz. Aktif hesap değişiminden sonra gecikmiş işlem eski hesabı geri yükleyemez. Hesap silinirken yalnız o hesaba ait medya favorileri kaldırılır; mevcut geçmiş saklama politikası korunur, silinen hesabın geçmişi aktif hesapta görünmez.

İlerleme yazımı provider, explicit playbackRef ve oturum epoch sahipliğiyle doğrulanır. Silme/temizleme eski oturumları geçersiz kılar; yeni oynatma yeni oturum açar. Native eski yüzey callback koruması korunur. Arka plana geçiş ve çıkış son snapshot'ı kaydeder; gerçek tamamlanma olayı süre sonunu kaydeder. İşletim sisteminin zorla öldürülmesinde son periyodik/arka plan kaydından sonraki saniyeler garanti edilemez.

| Kaynak | Film | Dizi/bölüm | Canlı |
| --- | --- | --- | --- |
| Xtream | Gerçek katalog ID, mevcut resolver | Gerçek seri/sezon hiyerarşisinde episode ID yeniden doğrulanır | Mevcut kanal yolu |
| M3U | Gerçek playlist item ID ve URL resolver | Mevcut gerçek gruplama/parent bilgisi varsa; eksik bilgi uydurulmaz | Mevcut playlist kanalı |
| Stalker | Mevcut oturum, kategori ve create_link yolu | Gerçek seriesId/seasonId/episodeId üçlüsü; opaque URL kimlik yerine geçmez | Mevcut destek sınırları değişmedi |

Kalıcı kayıtlara oynatma URL'si, cmd, parola veya TMDB kimliği eklenmez. Resume sırasında kaynak aktif sağlayıcıdan yeniden çözülür. Bulunmayan/karışık episode ID veya erişilemeyen katalog için açıklayıcı hata verilir. Mevcut TMDB Direct HTTPS ve metadata bileşenleri korunur; metadata playback kimliğini değiştirmez.

## Test kanıtı

Yerel son kontrol: 208/208 senaryo:
- V4 Home 18, Live 14, Movies 14, Series 22.
- Yeni persistence üretim context testleri 19; yeni Library üretim UI/resolver testleri 20.
- Gerçek Player/Home remote 20 (18 regresyon + 2 yeni).
- U4.3 Series 40; Stalker episode history/resume 41.

Yeni P4 senaryosu toplamı 41'dir. Kalıcılık, hesap ayrımı, yeniden açılış, silme/temizleme, hata/yeniden deneme, hızlı çift OK, eski callback, kategori filtreleri, Home rafı, modal/Sidebar/BACK ve Player dönüşü kapsanır. Üretim bileşenleri/context/resolver çalıştırılır; native platform, depolama ve provider ağı test sınırlarında taklit edilir. Bunlar gerçek portal veya fiziksel Android pencere testleri değildir.

TypeScript workspace/app/API/scripts kontrolleri ve V4 format kapısı uygulanır. Yeni testler mevcut Quality üretim host adımına dahil edilmiştir; Quality kontrolü azaltılmamıştır. CI sonucu final commit SHA ile birebir karşılaştırılır.

## Açık sınırlamalar / kabul

Fiziksel kabul: **DEFERRED_RC**. Homatics/Poco üzerinde fiziksel PASS verilmedi; gerçek uygulama ekran görüntüsü üretilmedi.
Eski silinmiş tamamlanmış kayıtlar geri getirilemez; eski canlı kayıtların bilinmeyen izlenme zamanı uydurulmaz.
Eski parent kimliği eksik bölümler History'de kalabilir ancak desteklenmeyen resume aksiyonu verilmez.
Poster metadata yoksa kontrollü tür/başlık fallback kullanılır. Silinmiş/yenilenmemiş katalog öğesinin açılması mevcut provider erişimine bağlıdır.
Mevcut provider başına medya geçmişi 100, canlı geçmişi 50 sınırı korunur.
Stalker Live kalan kapsamı ve P5 Settings bu fazda tamamlanmış sayılmaz.
GEN2, V3 ekran dosyaları, TMDB servisleri ve provider/playback motorları yeniden yazılmadı.
**APK üretilmedi**; bütünleşik Universal APK P5 ve kapanış sonrasına bırakıldı.

## Değiştirilen dosyalar

- `.github/workflows/quality.yml`
- `artifacts/legendstream-xplayer/components/CompatibilityVideoPlayerV2.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4ContentRail.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4FavoriteAction.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4Hero.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4Home.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4LibraryCatalog.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4LibraryDetail.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4MoviesCatalog.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4SeriesCatalog.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4Sidebar.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4TvShell.tsx`
- `artifacts/legendstream-xplayer/components/series/SeriesInfoModal.tsx`
- `artifacts/legendstream-xplayer/components/tmdb/MovieInfoModal.tsx`
- `artifacts/legendstream-xplayer/context/MediaLibraryContext.tsx`
- `artifacts/legendstream-xplayer/context/PlayerContext.tsx`
- `artifacts/legendstream-xplayer/lib/catalogPageRepository.ts`
- `artifacts/legendstream-xplayer/lib/contentFavorites.ts`
- `artifacts/legendstream-xplayer/lib/eliteV4HomeModel.ts`
- `artifacts/legendstream-xplayer/lib/eliteV4Library.ts`
- `artifacts/legendstream-xplayer/lib/eliteV4Movies.ts`
- `artifacts/legendstream-xplayer/lib/liveHistory.ts`
- `artifacts/legendstream-xplayer/lib/mediaProgress.ts`
- `artifacts/legendstream-xplayer/lib/pagedSeriesFlow.ts`
- `artifacts/legendstream-xplayer/lib/progressMutations.ts`
- `artifacts/legendstream-xplayer/tests/eliteV4LibraryProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4LiveProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4MoviesProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4PersistenceProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4ProductionHostScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4SeriesProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/stalkerR17FEpisodeHistoryResumeScenarios.ts`
- `artifacts/legendstream-xplayer/tests/visibleHomeRemoteScenarios.mjs`
- `docs/elite/ELITE_V4_P4_LIBRARY_TR.md`
- `docs/project/FEATURE_PARITY_MATRIX_TR.md`
- `docs/project/INTEGRATION_LEDGER_TR.md`
- `docs/project/OPEN_ISSUES_TR.md`
- `docs/project/PRODUCT_ROADMAP_TR.md`
- `docs/project/RELEASE_ACCEPTANCE_TR.md`
