# Elite V2 — Kontrollü Live TV uygulama raporu

## Doğrulanmış kaynak kapısı

- main: `810adc2f7e82da52d8dd6768fcd5cf1d3040e106`.
- PR #138 HEAD: `3755a39b48441fd0904d3a40a7a8c77576ee0281`.
  Base: `feature/r18-tv-remote-focus-inspector` / `e8bb4d3119a694e87d1988f58445d5364ccafc44`.
  Draft/open/not merged. Exact HEAD Quality: [38908602285](https://github.com/d3vilsgo/Legend-Stream/actions/runs/38908602285), success.
- PR #139 başlangıç HEAD: `c65b9ed2c6f200f6c79137ba9bed089b20a17620`.
  Base: `feature/r18-native-tv-premium-ux` / #138 HEAD.
  Draft/open/not merged. Başlangıç Quality: [38965005317](https://github.com/d3vilsgo/Legend-Stream/actions/runs/38965005317), success.
- Çalışma aynı #139 branch'inde ileri commit olarak yapılır; retarget/rebase/reset yok.

## Kaynak kanıtı ve en küçük kapsam

| Dosya | Kanıt | Kullanıcı etkisi / sınır |
|---|---|---|
| ProductShell.tsx | Provider'a göre StalkerMainPage veya paged delegate seçiyor | Ortak ekran yerine iki gerçek giriş ayrı bağlanmalı |
| OptimizedHomeScreenPaged.tsx | openLive kaynak çözüp view=player yapıyor; katalog Back player owner'ı kontrol ediyor | Gömülü video preview yok; player yaşam döngüsü korunur |
| StalkerMainPage.tsx | Stalker Live onOpen ayrı playback girişine gidiyor | Stalker taşıma/çözümleme korunur |
| PagedCatalogViews.tsx | PagedLiveCatalog useCatalogPage ve useLiveCategorySelection kullanıyor | Yeni sunum yalnız Platform.isTV dalı; provider verisi aynı |
| StalkerLiveCatalog.tsx | sync/categoriesReady ve cached kategori/page kullanıyor | Native sunum aynı hazır veriyi alır; telefon pager'ı korunur |
| TVPreviewFocus.tsx | TVPreviewPressable useNativeTvTarget; gerçek event odak vurgusu | Yalnız opt-in eliteVisual rengi/gölgesi; event sahipliği değişmez |
| CompatibilityVideoPlayerV2.tsx | advancePlayerBack + BackHandler/native aboneliği var | Fiziksel çift teslim/çıkış sorunu bu PR'da düzeltilmez |
| PlayerChrome.tsx / PlayerChromeV2.tsx | Ortak player callback'leri ve mevcut dock | İkinci player/action modeli eklenmez |
| VlcPlaybackSurface.tsx | Mevcut tek VLC yüzeyi | Yeni gömülü motor veya yeniden bağlama yok |

## Değişen dosyalar

- `docs/elite/LEGEND_ELITE_V2_FINAL_VISUAL_CONTRACT_TR.md`: nihai yön, durumlar, hedef Back tablosu ve fiziksel kabul.
- `components/elite/EliteLiveCatalog.tsx`: gerçek kategori/kanal/EPG yüzeyi; explicit selection, tam ekran izle, favori, yenileme, arama, sayfalama, panel düğmesi.
- `lib/design/eliteLiveLayout.ts`: ölçülen dp geometri, katman yüzeyleri ve bağımsız seçim reducer'ı.
- `components/catalog/PagedCatalogViews.tsx`: Native TV Xtream/M3U adapter.
- `components/catalog/StalkerLiveCatalog.tsx`: Native TV Stalker adapter.
- `components/tvPreview/TVPreviewFocus.tsx`: Elite için opt-in görsel vurgu; native kayıt ve ownership aynı.
- `tests/eliteLiveLayoutScenarios.ts`: 48 geometri + seçim/panel + kontrast senaryoları.
- `.github/workflows/quality.yml`: yeni senaryo mevcut Quality'ye eklenir.
- Bu rapor.

## Gerçek uygulama ile hedef arasındaki açık farklar

Bu teslim kısmi ilk üretim kesitidir; V2 bütünü tamamlanmış değildir.
Sağ alan gerçek kanal/Şimdi/Sonraki bilgisidir, video önizlemesi değildir.
Mevcut navigasyon korunur; ince rail dönüşümü yapılmaz.
Panel inline kategori/kanal alanıdır: düğmeyle açılır/kapanır, modal overlay
ve yeni Back owner eklenmez. Back ile bu yeni panelin kapanması henüz yoktur.
Player çıkışında yeni ekranın seçili kanal/scroll/focus restorasyonu ayrıca
uygulanıp fiziksel test edilmelidir; yerel state unmount sırasında kaybolabilir.
Bunlar tam kabulü engelleyen açık maddelerdir; başarı olarak sayılmaz.

## Yerel doğrulama

TypeScript geçti. Yeni 48 geometri senaryosu: 960×540, 1280×720, 1920×1080,
1536×864 dp × fontScale .85/1/1.3/1.6/2/3 × iki inset profili.
Seçim/focus ayrımı, panel toggle sırasında seçim, kayıp ID için null ve
beyaz video varsayımında ikincil metin kontrast hesabı geçti.
Mevcut responsive JS/JVM 240/240; native odak JVM 33/33, kararlılık21/21;
remote25/25, exit6/6, TV Preview32/32, inspector35/35, presentation lifecycle14/14,
Elite V1 testleri geçti. Provider/paging/redaksiyon kontrolleri ve tam CI
ayrıca exact HEAD üzerinde yürütülür.

Bu yeni ekran için mounted Android renderer davranış testi yapılmadı.
Geometri/reducer testi gerçek D-pad/OK, render edilen metin ölçüsü, focus
halkasının kesilmemesi veya playback sürekliliği kanıtı değildir.
Yerel pnpm11 otomatik install/build policy engeli yüzünden mevcut kurulu
TypeScript ve `node --import tsx` kullanıldı; dependency/lockfile değiştirilmedi.
CI committed pnpm10 akışını kullanır.

## Fiziksel tur ve sonraki küçük PR

Final contract'taki 12 adımlı Homatics turunu, Xtream/M3U/Stalker için ayrı
tekrarla. Panel düğmesini, kategori aramasını, son sayfayı, eksik logo/EPG,
uzun Türkçe adlar ve Inspector açık/kapalı durumları dene. Player çıkış ve
hidden focus loop çözülene kadar **Native TV Physical FAIL**.

Öncelikli ayrı davranış PR'ı: Back teslimi/restore olay sırası; ardından yeni
Live ekranı için aynı kategori/kanal ve scroll restorasyonu ile panel Back.
Sonrasında tek VLC yüzeyinin preview/fullscreen yaşam döngüsü. Home dönüşümü
bu kapılar sonrasında küçük ayrı kesit olarak ele alınır. APK üretilmez.
