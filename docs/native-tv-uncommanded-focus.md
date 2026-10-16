# Native TV — tuşsuz odak hareketi denetimi

## Kaynak ve fiziksel kanıt

Remote gate: PR #136 OPEN/DRAFT/NOT MERGED, `d9f279ad4033c69906397a76750401a2d7d575ec`; Inspector PR #137 OPEN/DRAFT/NOT MERGED, `c375b8faf09ac4fb3915ee86342bcecdf5535a74`. Çalışma mevcut `feature/r18-tv-remote-focus-inspector` branch'inde ilerler. Reset/yeni PR/merge yoktur.

Homatics kullanıcı bildirimi: tuşsuz odak hareketi, seçim güçlüğü ve tasarım kusurları. `VID_20261016_105716.mp4`, 66,4 saniye: Live araçları, player dock/liste, Home hero ve VOD posterleri örnek karelerden incelendi. Odağın beyaz çerçevesi görünür; sağ menü öğeleri kesilir; birkaç VOD görseli yerine play simgeli fallback vardır. Video üzerinde Inspector izi veya kesin APK/SHA kanıtı yoktur. Bu video **#502 exact-SHA testi olarak sınıflandırılmaz**; tuş zamanları ve donanım kaynaklı tekrar videodan kanıtlanamaz. Kullanıcı bildirimi kabul kusurudur; fiziksel FAIL korunur.

## P0 — doğrulanmış kaynak mekanizmaları

| Dosya → gerçek kanıt | Kullanıcı etkisi / yeniden üretim | Kök neden → en küçük düzeltme → regresyon |
|---|---|---|
| `TVPreviewFocus.tsx` nativeFocusedId değişiminde `hasTVPreferredFocus` değerini render üzerinden true yapıyordu. RN 0.81.5 `ReactViewManager.kt:setTVPreferredFocus` true değerinde doğrudan `view.requestFocus()` çağırır | Native odak → JS commit → yeni programatik focus isteği hattı vardır; eski commit/yeni giriş yarışında eski hedef tekrar istenebilir | Fiziksel odağa ikinci render sahibi. Native TV'de prop false; tercih yalnız native registry'de başlangıç adaylığıdır. Gerçek vurgu yalnız native focus sinyalidir. Kontrat testi bu tek sahipliği ve kaldırılan JS restore'u denetler |
| Aynı provider scope pop'u hem native `setScope` restore'u hem requestAnimationFrame içindeki JS `requestTargetFocus` çağrısını üretiyordu | Modal/player dönüşünden sonra gecikmiş JS işi yeni kullanıcının seçimini geri alabilir | İki restore sahibi. JS fiziksel restore kaldırıldı; telefon Preview controller davranışı korundu. Scope ticket testi eski scope işini reddeder |
| Kotlin `restore()` 32 ms sonra yalnız scope eşitliği kontrolü yapıyordu; `registerTarget/onLayout` tekrarları birden çok iş kuyruğa alabiliyordu | A için kuyruklanan iş, kullanıcı B'ye geçtiğinde A'yı tekrar isteyebilirdi | İptal/revision/current-focus guard yoktu. Tek Runnable, üretim `TvFocusStability` revision ticket'ı; yeni DOWN, gerçek odak değişimi, scope değişimi veya unregister iptal eder. Callback registry kimliği, attach/visible/enabled ve mevcut geçerli focus'u tekrar doğrular. Eksik hatırlanan hedefte rastgele preferred fallback yok. Eski ticket/tuş/render/sanallaştırma testleri |
| `useNativeTvTarget` her layout'ta kaydı tekrar yolluyor; effect kimlik/tercih güncellemesinde unregister/register yapıyordu | Layout akışı focus registry hareketi gibi ele alınabilir | Kimlik kaydı ile geometri birbirine bağlıydı. Aynı tag/ID/scope/disabled/preferred kaydı idempotent; geometri native move anında ölçülür. Unregister gerçek tag değişimi/disable/unmount içindir |
| FocusButton border 1→3, TVPreviewPressable border yok→4 değişiyordu | Odak vurgusu geometriyi değiştirebilir ve yeniden layout üretebilir | Vurgu layout'u etkiliyordu. TV'de kalınlık sabit, yalnız renk değişir; telefon stilleri korunur |
| Window callback sahipliği tek kurulumu hedefliyordu; aynı event için kesin dispatch lease'i yoktu | Çift teslim/nested callback kontrol edilmemişti; videoda gerçekten çift donanım olayı olduğu kanıtlanmış değildir | Üretim gate device/downTime/key/action/repeat kimliğiyle aynı olayı bir kez uygular. İç içe geçişte native işlem tekrarlanmaz, eski callback'e devredilir. Farklı repeat count korunur; UP sonrası aynı press'in geç repeat'i reddedilir. Hidden player yön repeat'leri de mevcut remote action'a gider; Back/OK/media toggle uzun basışı çoklu seçim yapmaz. 21 Java davranış senaryosu |

Bu tablo fiziksel videonun tek ve kesin kök nedenini kanıtladığımız anlamına gelmez. **Kaynakta doğrulanan kontrol yarışları düzeltildi**; fiziksel olayın hangi dalı izlediği yeni cihaz iziyle belirlenecek.

Player panelleri `player-panel:content/audio/subtitles/codec` scope’larına ayrıldı. Panel açıkken arka player kontrolleri focusable değildir; başlangıçta panelin kapatma hedefi native tercihli adaydır. Panel kapanışı önceki player scope’unu geri getirir. Bu düzen, kaldırılan RN preferred-focus yan etkisinin panel erişimini bozmaması içindir. Snapshot bir gerçek odak hareketi olarak sayılmaz.

## Olay paneli

Mevcut varsayılan kapalı test modu kullanılır. Her gerçek global focus değişiminde önceki/yeni anonim ID native observer'dan kaydedilir. Aynı View'ın tekrar kaydı veya başarılı requestFocus dönüşü ikinci bir hareket diye sayılmaz.

- `native-input`: senkron native dispatch sırasında veya bilinen yön focus isteğinde hareket.
- `mount-restore`, `scope-restore`, `scope-unblock`, `explicit-restore`: uygulamanın bildiği programatik focus talebi.
- `layout-correlated`, `virtualization-correlated`, `target-registration-correlated`, `modal-transition-correlated`, `scope-transition-correlated`: yakın native yapısal olayla zaman ilişkisi; **kesin neden değildir**. 100 ms ilişki penceresi kullanılır.
- `unknown`: belirlenemeyen kaynak. Kaynak tahmin edilerek fiziksel tuşa bağlanmaz.

`timeMs` ve `inputAgeMs` Android monotonic elapsedRealtime kullanır. Paneldeki Δtuş, focus olayı anında son native DOWN/UP olayından geçen süredir; canlı artan sayaç değildir. Uygulamaya iletilen native event, donanımın fiziksel kökenini tek başına kanıtlamaz.

Senkron input dışında ve son native olaydan >150 ms sonra (veya hiç input gözlenmeden) oluşan değişim **TUŞSUZ ODAK** olarak işaretlenir. Bu bir teşhis alarmıdır; gerekli programatik scope dönüşü de bu etiketi alabilir. Kaynak ve Δtuş birlikte okunmalıdır. Keyup sonrası gecikmiş repeat `late-repeat`, aynı teslim `duplicate` olarak görünür.

Observer dispatch sonucunu değiştirmez; dedupe/lifecycle düzeltmesi mevcut native input sahibindedir ve Inspector kapalıyken de geçerlidir. Panel focus/pointer hedefi değildir; playback motoruna yazmaz. Son 20 kayıt yalnız bellekte, kimlik/süre/kaynak alanları allowlist ve anonimdir; yeni kalıcı log/export yoktur.

## P1 — video ile sınırlı tasarım denetimi

| Dosya → kanıt | Kullanıcı etkisi | En küçük düzeltme / bu tur durumu |
|---|---|---|
| `OptimizedHomeScreenPaged.tsx` headerTop minHeight 48 + ayrı nav; `ResponsiveContentNav.tsx` horizontal ScrollView ve 50+ dp butonlar. Videoda sağdaki menü kesiliyor | Diğer bölümlerin varlığı kolay anlaşılmıyor; header ve araçlar içeriğe az alan bırakıyor | TV'ye özel başlık/araç yoğunluğu ve sağa devam ipucu ayrı küçük UX işi olabilir. Bu tur header veya genel tema yeniden yazılmadı |
| `PagedCatalogViews.tsx` arama, kategori hedefi, manual EPG ve sıralama ayrı satırlarda | Videodaki Live üst alanı birkaç kanal satırı kadar yer kaplıyor | TV'de araçları tek ölçülü toolbar'a toplama en küçük tasarım adayı; bu tur raporlandı, odak grafiği kararlılığı öncelikli |
| `PagedCatalogViews.tsx:GridCard`, `StalkerGoldenMoviesCatalog.tsx` Image doğrudan URI ile; boş URI'de play fallback, load failure ayrımı eksik. `HomeDiscovery.tsx:ResilientCatalogImage` ise onError destekli | Videoda benzer boş posterler birbirinden zor ayrılıyor. Eksik/bozuk URI nedeni videodan ayırt edilemez | Mevcut resilient image yolunu katalog kartlarıyla paylaşmak ve “görsel yok” durumu eklemek; provider poster verisi/URL çözümlemesi bu tur değiştirilmedi |
| `TVPreviewPressable`, `FocusButton` fiziksel vurgu ile selected/active prop'ları ayrı; focus border geometriyi değiştiriyordu | Çerçeve görünürken bile hedef yerleşimi oynayabilir | Bu tur sabit TV border kalınlığı ve yalnız native vurgu uygulandı; aktif sekme state'i korunur |
| `PlayerChrome.tsx` TV dock 64 dp, ikon 28 dp; `PlayerRemotePressable` focus etiketi absolute bottom -28 | Videoda seçili etiket ve panel kapatma yazısı kontrol çevresinde tekrarlanıyor; alt kenarda örtüşme/kesilme riski | Etikete ayrılmış sabit boşluk/tek satır başlık ayrı küçük UX adayı. Bu tur player işlevleri/ölçek/tema yeniden yazılmadı |

## Doğrulama ve kabul

Üretim Java odak politikası 33/33 ve yeni stability policy 21/21; Inspector 35/35; mevcut remote 25/25, TV Preview 32/32; Android Universal kontratı ve TypeScript. Quality mevcut M3U/Xtream/Stalker katalog/provider/security regresyonlarını korur. Writer, credentials, provider protokolü, PlayerContext ve android-apk.yml değiştirilmez.

Bu testler gerçek RN commit sırasını, ViewTreeObserver/Window/Modal davranışını, OEM repeat zamanlamasını, sanallaştırılmış Android View'ı veya VLC'yi çalıştırmaz. JVM testleri Android'de kullanılan aynı policy'yi çalıştırır; gerçek cihaz PASS yerine geçmez.

Yeni Homatics turu: Inspector aç → Home/Live/VOD/Series'de tek basış, uzun basış, bırakma → 10 saniye hiç tuşa basmadan bekleme → veri yüklenmesi/scroll/paging → odaktaki hedefte OK → player kontrolü ve modal Back. Her beklenmeyen hareket için önceki/yeni ID, kaynak ve Δtuş birlikte kaydedilmeli. Inspector kapalı/açık aynı tur karşılaştırılmalı. Xtream, M3U ve Stalker ayrı test edilmeli.

**Native TV Physical FAIL / yeni fiziksel doğrulama gerekli. PR Draft kalır; merge yoktur.**
