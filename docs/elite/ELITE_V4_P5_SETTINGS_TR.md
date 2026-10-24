# Elite V4 P5 — Premium Settings ve Hesap Yönetimi

Başlangıç SHA: `87ab5ce6c815061ba97b2ebbc6b5b85809383098`.
PR #143 OPEN/DRAFT; branch `integration/legendstream-u1`; base `feature/r19-tmdb-secure-proxy`.
Final SHA ve exact-SHA Quality sonucu teslim mesajında aynı commit ile doğrulanır.

## Kaynak ve ortam

Remote kaynak ve başlangıç Quality #1634 SUCCESS doğrulandı. Kurtarılmış .git ve temiz başlangıç çalışma ağacı kullanıldı. Önceki bağımlılık symlink hedefi bu oturumda bulunmadığından bağımlılıklar mevcut lockfile üzerinden pnpm 10 ile yeniden hazırlanır. Lockfile veya provider sözleşmesi değiştirilmez.

## Ürün kapsamı

V4 Sidebar Settings artık V4 içinde açılır. Geniş ekranda kategori/ayar panelleri, küçük ekranda yatay kategori şeridi ve tek sütun ayar listesi vardır. Mevcut grafit yüzeyler, küçük tipografi ve 1dp turkuaz Focus kullanılır. Uzun ayar listesinde odaklanan kontrol görünür alana kaydırılır. BACK panelden kategoriye, kategoriden Sidebar'a döner. Native Player BACK sahipliği korunur.

Kontroller:
- Hesaplar: kayıtlı Xtream/M3U/Stalker hesapları, aktif/kayıtlı/bilgi gerekli durumu, hesap seçimi, ekleme, düzenleme, onaylı silme, aktif playlist yenileme.
- Player: mevcut kontrol gizleme süresi 3/5/10 saniye ve VLC otomatik/donanım/yazılım çözme tercihi. Etki sonraki Player açılışındadır.
- Katalog/EPG: mevcut otomatik katalog yenileme, 24/72 saat aralığı, manuel katalog yenileme, aktif hesabın manuel EPG yüklemesi. Stalker mevcut Live yenileme kapsamıyla sınırlıdır.
- Dil: mevcut uygulama dil listesi ve mevcut I18n setter'ı. V4'e özgü çevrilmemiş metinler Türkçe kalabilir; tam çok dilli V4 kabulü iddia edilmez.
- Geçmiş/bakım: gerçek V4 History ve Favorites yönetimine geçiş; yalnız aktif hesabın canlı geçmişini veya medya geçmişi/resume kayıtlarını ayrı onaylarla temizleme; cihaz genelindeki Player tanılama günlüğünü kapsamı açıklanarak temizleme.

Genel uygulama verisi veya bütün hesapları sıfırlama kontrolü yoktur. Bu geliştirmede gerçek kullanıcı hesabı veya verisi silinmemiştir; silme davranışı test doubles üzerinde doğrulanır.

## Mevcut sözleşmeler

Settings yeni bağımsız depolama oluşturmaz:
- Player kontrol süresi: `@legendstream/player-chrome-timeout-v1`.
- VLC çözme modu: Player'ın zaten kullandığı `@legendstream/codec-mode-v1`.
- Dil: `@legendstream/language-v1`; V4 doğrulanmış yazma seçeneği kullanır. V3'ün mevcut varsayılan çağrı biçimi korunur.
- Katalog politikası: mevcut CatalogSyncContext refreshPolicy/setRefreshPolicy.
- Hesaplar: mevcut PlayerContext connectProvider/setActiveProvider/removeProvider/refreshProvider ve güvenli credential altyapısı.
- History/Favorites: P4'ün aynı provider/account kapsamlı depoları.

Player tercihlerinde değer doğrulama ve yazma sonrası geri okuma vardır; hatalı kayıtta güvenli varsayılan kullanılır. Dil yüklemesinin gecikmiş sonucu yeni kullanıcı seçimini ezemez. V4 dil yazma hatasında önceki seçili değer korunur.

## Hesap güvenliği ve Focus

Hesap formu mevcut connectProvider veri sözleşmesini kullanır. Parola, kullanıcı adı, MAC ve playlist/EPG URL alanları maskelidir; token veya ham hata içeriği ekranda/logda gösterilmez. Kaynak türü, URL, Xtream kullanıcı/parola ve Stalker MAC gereklilikleri doğrulanır. Mevcut hesap türü düzenleme sırasında değiştirilmez.

Destructive onay hedef hesabı ve veri kapsamını açıklar. Hesap değişimi veya kapatılmış/değiştirilmiş modal eski callback'i geçersiz kılar. Tek işlem kilidi hızlı çift OK ve eşzamanlı yanlış aksiyonu engeller. Modal arkasındaki Settings kontrolleri devre dışıdır; ayrı native/Preview Focus scope kullanılır. İptal önceki kontrol odağına döner.

ProductShell'de açık V4 seçimi provider Focus scope yeniden kurulurken bellekte korunur. İlk açılış varsayılanı V3 kalır; V3/V4 geçiş düğmesi korunur. Hesap değişiminde ekranların provider kapsamı yeniden kurulur, yeni hesabın V4 Home odağı açılır. Eski hesabın detay/Player durumu taşınmaz.

## Destek sınırları

Global varsayılan ses/altyazı/ekran oranı veya resume kapatma tercihi kaynakta bulunmadığından sunulmaz; mevcut Player paneli kullanılmaya devam eder.
EPG zaman kayması, bağımsız V4 tema sistemi, global katalog sıralaması, genel katalog/TMDB cache temizleme veya zorunlu metadata yenileme anahtarı oluşturulmaz. Sıralama mevcut Movies/Series ekranındadır; metadata mevcut TMDB Direct HTTPS ve tr-TR sözleşmesini kullanır.
Provider erişimi veya portal yeteneği yoksa hesap bağlantısı/EPG/katalog yenileme garanti edilemez. Boş/başarısız EPG sonucu başarı olarak sunulmaz.
Player tanılama temizliği cihaz genelidir ve onay metni bunu açıklar.
P4'ün eski parent kimliği eksik episode resume sınırları değişmez.
Kalan Stalker Live kapsamı ve bütünleşik ürün kapanışı ayrı görevdir.

Fiziksel kabul: **DEFERRED_RC**. Homatics/Poco fiziksel PASS iddiası yoktur.
**Universal APK üretilmez.** Yeni branch/PR/merge/backend veya GEN2 değişikliği yoktur.

## Test ve regresyon kanıtı

Yeni P5 kapsamı: 28 senaryo (Settings 25, gerçek Player tercih tüketimi 1, ProductShell hesap değişiminde V4 seçimi 1, Settings/Library BACK entegrasyonu 1).
Yerel seçili grup: 354/354:
- V4 Home/Sidebar/ProductShell 19; Live 14; Movies 14; Series 22.
- P4 persistence 19; Library 21; Settings 25.
- Gerçek Player/Home remote 21; U4.3 Series 40; Stalker episode history/resume 41.
- Media progress 31; Live history 32; UI presentation 23; TV Preview 32.

Üretim UI/context/preference/controller çalıştırılır; native platform, provider ağı ve depolama sınırları test doubles ile çevrelenir. Gerçek portal/cihaz kabulü değildir. Yeni testler mevcut Quality üretim host adımına dahil edilir. Eski testler kaldırılmaz; host adapter'larına yeni UI sınırı ve React Context sözleşmesi eklenir.

Workspace references, mobil app, API ve scripts TypeScript kontrolleri; V4 ve ilgili helper/test format kapısı; git diff whitespace kontrolü uygulanır. Yerelde çalıştırılabilen ağ gerektirmeyen tek komutlu ek Quality senaryoları da geçti. Final commit için remote exact-SHA Quality zorunludur; başlangıç #1634 yeni kaynak için PASS sayılmaz.

## Değişen dosyalar

- `.github/workflows/quality.yml`
- `artifacts/legendstream-xplayer/components/ProductShell.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4AccountEditor.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4Settings.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4SettingsDialog.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4Sidebar.tsx`
- `artifacts/legendstream-xplayer/components/eliteV4/EliteV4TvShell.tsx`
- `artifacts/legendstream-xplayer/context/I18nContext.tsx`
- `artifacts/legendstream-xplayer/lib/playerPreferences.ts`
- `artifacts/legendstream-xplayer/tests/eliteV4LibraryProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4LiveProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4MoviesProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4ProductionHostScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4SeriesProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/eliteV4SettingsProductionScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/u43SeriesFlowScenarios.mjs`
- `artifacts/legendstream-xplayer/tests/visibleHomeRemoteScenarios.mjs`
- `docs/elite/ELITE_V4_P5_SETTINGS_TR.md`

- `docs/project/FEATURE_PARITY_MATRIX_TR.md`
- `docs/project/INTEGRATION_LEDGER_TR.md`
- `docs/project/OPEN_ISSUES_TR.md`
- `docs/project/PRODUCT_ROADMAP_TR.md`
- `docs/project/RELEASE_ACCEPTANCE_TR.md`
