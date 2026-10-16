# Elite V1 — Fark analizi, risk matrisi ve küçük PR planı

## Gerçek kaynak bulguları

| Dosya → kanıt | Kullanıcı etkisi / tekrar | En küçük yaklaşım | Regresyon |
|---|---|---|---|
| `constants/colors.ts` → cyan primary, blue accent; `lib/design/tokens.ts` → başka scale/radius setleri | Focus ve marka vurgusu yüzeylere göre değişiyor; Home/nav/player karşılaştırılır | Yeni opt-in Elite token; eski palette toplu overwrite yok | 8 Focus/Selected/Active birleşimi, kontrast |
| `PlayerChrome.tsx` → gerçek controls; `PlayerChromeV2.tsx` → ortak panel/çok sayıda yerel rgba | Yalnız V2 görselini değiştirmek gerçek player'ı birleştirmez | Önce sözleşme/showcase; sonra iki katmanda aynı token, aynı callbacks | Play/Pause/seek/tracks/exit; telefon |
| `FocusButton.tsx` → animated scale; `TVPreviewFocus.tsx` → başka border/background; native module outline | Birden çok focus görsel sahibi; ring ve outline çakışabilir | Üretim migrasyonunda tek çizici seçimi; V1 showcase sabit ring | Her komşu, no-layout-shift, native outline |
| `ResponsiveContentNav.tsx` → yatay gerçek sekmeler | Sol rail henüz ürün davranışı değil; yeni rail ile focus rotası değişir | Önce ayrı showcase rail'i; sonraki PR'da mevcut onSelect korunur | Home→Live→Movies→Series→Settings, Back |
| `PagedCatalogViews.tsx`, `StalkerGoldenMoviesCatalog.tsx` → provider ayrı grid/satır yolları | Ortak görünüm uğruna kategori/paging semantiği bozulabilir | UI props adaptörleri; protokoller değişmez | Xtream/M3U/Stalker parity |
| `HomeDiscovery.tsx` → hero, shelves, mevcut kararlı kimlikler | Büyük hero/kesilen etiketler; focus restore riski | Gerçek parent ölçüsü ve üst yükseklik sınırı; ayrı küçük Home PR | FontScale, scroll, idle focus |
| `CompatibilityVideoPlayerV2.tsx` → native ve RN Back aboneliği + `claimPlayerBack` + senkron snapshot | Kaynak guard'ları var, kullanıcı cihazda çıkamıyor; fiziksel bug açık | Tasarım PR'ında fix iddiası yok; önce olay hattı forensic P0 PR | Panel→dock→exit→aynı katalog ID |
| `NativeTVFocusScope.tsx` → blocked scope/clearFocus; native module → restore, layout ve focus observer | Hidden player focus döngüsünde olası etkileşim; henüz doğrulanmış kök neden değil | Gerçek APK/SHA ile observer/restore nedenlerini incele | Hidden idle 30 sn, inspector on/off |
| `usePlayerOrientation.ts`, `UiPresentationContext.tsx` → ayrı orientation ownership | Yeni route/provider eklenirse eski orientation regresyonu dönebilir | Showcase production route/provider ağacına eklenmez | Mobil player giriş/çıkış/dönüş |
| `stalkerProductEpg.ts` ve `stalkerEpg*Probe` → ürün ve tanı yolları ayrı | Yetenek bayrağı gerçek program verisi var demek değil | Eşleşmiş geçerli veri varsa Now/Next | EPG yok/boş/expired, source ayrımı |

## Risk ve regresyon matrisi

| Risk | Öncelik | V1 önlemi | Kabul kanıtı |
|---|---|---|---|
| Player'dan çıkış yok | P0 açık | Playback/Back kodu değiştirilmez; migrasyonu bloke eder | Homatics exact APK/SHA, gerçek Back |
| Hidden kontrollerde focus döngüsü | P0 açık | Yeni observer/interceptor eklenmez | 30 sn idle kaydı, native event/action ayrımı |
| Scope odağı çalıyor | P0 | Showcase background targets disabled, panel opener restore | Web DOM testi + ayrı native entegrasyon |
| D-pad beklenmeyen rota | P0 | Web-only test harness; native policy değiştirilmez | Mevcut JVM + fiziksel dört yön |
| Metin taşması/kenar clipping | P1 | dp hesap, max içerik/poster, ellipsis/full label, scroll | Saf matris + render kontrolü |
| Overlay kontrastı | P1 | .84 bilgi/.94 interaktif/.98 hata; metin opak | Siyah/beyaz arkaplanda alpha-bileşim kontrastı ≥4,5 |
| Mobil orientation | P0 | Yeni route/Orientation hook yok | Mevcut lifecycle/orientation testleri |
| Provider uyumsuzluğu | P0 | Sadece fiction fixtures; API import yok | Tam mevcut Quality/parity |
| Render maliyeti | P1 | Blur ve animasyon yok; fixture sayısı sınırlı | Gerçek TV fps/heap ölçümü sonraki faz |
| Prototype yanlışlıkla ürün sayılıyor | P1 | Showcase başlığı, mock veri, yayın yok; normal app import etmez | Bağımlılık izolasyon testi ve diff |

## Sıralı küçük PR planı

1. **Bu PR:** dört sözleşme, bu audit/plan, opt-in token, RN Home/Live row/tek overlay ve aynı RN bileşenlerini render eden web laboratuvarı. Normal uygulama ekranı değişmez.
2. **Önce P0:** doğrulanmış APK/SHA'da Back teslimi ve hidden focus döngüsü; iki ayrı bulgu için kök neden + minimum fix. Exact Quality, Universal APK, Homatics kabul. Tasarım migrasyonundan bağımsız.
3. **Görsel primitive:** tek focus renderer, label/icon/row/card token adaptörü; bir Live satırında feature gate. Mobil ve Preview ayrı kabul.
4. **Live dikey kesit:** rail→kategori→kanal→aynı mevcut player→Back→aynı ID. Bu zincir fiziksel geçmeden geniş migrasyon yok.
5. **Overlay:** hızlı kanallar, audio/subtitles/codec; tek scope ve autohide sahipliği. Yeni motor veya yeni özellik taklidi yok.
6. **Home:** bounded hero + provider-scoped gerçek Devam Et/Favoriler/Son İzlenenler; içerik yükleme/skeleton korunur.
7. **VOD/Series:** poster→detay→sezon/bölüm→oynat→aynı kimlik. Xtream/M3U/Stalker uyumluluğu ayrı.
8. **Mobil/tablet uyarlama:** aynı token dili, farklı navigation/target; orientation ve erişilebilirlik fiziksel testleri.
9. **Performans ve kapanış:** düşük güçlü TV, Homatics, 720/1080/4K-dp, fontScale, TalkBack/reduced-motion; fiziksel ölçümlere göre küçük tuning.

Her PR Draft açılır; merge/close/retarget otomatik yapılmaz. Teknik test sonucu fiziksel ürün PASS olarak sunulmaz.

## Prototipi çalıştırma

App klasöründe `node scripts/build-elite-showcase.mjs /tmp/legend-elite-preview`; ardından `python -m http.server 8765 --directory /tmp/legend-elite-preview`.
Tarayıcıda http://localhost:8765. Pencere, fontScale ve safe-area seçilebilir. Enter seçim; yönler web fixture focus; Escape panel kapatma. Bu web helper normal Android kumanda yoluna bağlanmaz. Çıktı bundle'ı repoya commit edilmez.

`EliteShowcase.tsx` React Native View/Text/Pressable/ScrollView ve mevcut react-native-svg kullanır. Expo app route'una eklenmez; native wrapper entegrasyonu sonraki PR'dır. Üretim player/provider/session/orientation imports yoktur. Showcase'da veri örnektir; tıklamalar playback başlatmaz.

## İlk uygulamanın test sonucu

- TypeScript: yeni RN bileşeni, SVG çizimleri ve web entry aynı app typecheck kapsamındadır.
- `eliteDesignScenarios.ts`: 84 geometri/durum/kontrast senaryosu ve reducer/bağımlılık sınırı testleri geçti. Mobil, tablet, Native TV ve Preview ayrı modlardır.
- Gerçek Chromium render: 6 pencere × 5 fontScale × 2 safe-area = 60/60. Her senaryoda kritik hero hedefi kaydırılarak görünür ve pencere içinde kalır. Focus beyaz border, Active bölüm ve Selected kanal birbirinden bağımsız olarak DOM'da doğrulandı; OK, dört yön ve Escape/opener restore test edildi.
- Web panelinde salt geometrik yakınlık Close→liste geçişinde satır atlatabiliyordu. Yalnız web fixture panelinde açık dikey sıra tanımlandı; yeniden test geçti. Android'in gerçek focus algoritmasına değişiklik yapılmadı.
- Kaynak biçimi: Prettier check; repo genelinde mevcut bir ESLint/lint komutu veya yapılandırması yoktur. Bu çalışma bunu “ESLint PASS” diye sunmaz. Console guard ve TypeScript ayrıca çalışır.
- Mevcut native JVM/kararlılık, çıkış, orientation lifecycle, TV Preview ve responsive matris yeniden çalıştırılır; tam mevcut Quality exact commit üzerinde otoritedir.
- Tasarım hareket süreleri token olarak tanımlıdır; prototipte blur/animasyon ve yeni player kullanılmaz. Frame-time/heap ölçümü veya gerçek medya motoruyla süreklilik testi yapılmadı.
- Tarayıcı testi native focus, fiziksel kumanda, video üstü gerçek Android compositing, TalkBack ve orientation restore'u simüle etmez. Ürün Physical FAIL/P0 durumu sürer.

Yeni Draft PR, final SHA ve exact-SHA Quality run bağlantısı teslim raporunda/PR açıklamasında verilir; kendi commit SHA'sını içine yazan döngüsel kaynak dosyası üretilmez.
