# PR #138 — Native TV responsive UX kapısı

Başlangıç remote HEAD: `090430473674b0a5ce0d575d23eb8940712fffc1`.
Mevcut `feature/r18-native-tv-premium-ux` dalı korunur; PR Draft kalır. Merge yapılmaz.
Başlangıç SHA'sı için Actions sorgusunda Quality çalışması bulunmadı. Yeni dal push'u Quality kapsamına eklendi; kesin son SHA ve run bağlantısı PR açıklamasında tutulur.

## Kaynak kanıtı ve düzeltme

| Dosya / yüzey | Kanıt ve kullanıcı etkisi | Uygulama |
|---|---|---|
| `PlayerChromeV2.tsx` | TV'de koşulsuz 104×82 dp; font ve pencere büyüklüğü hesaba katılmıyor | Güvenli dp alanı, kontrol sayısı ve fontScale ile araç genişliği/yüksekliği; min hedef 56 dp; taşan araçlar yatay kaydırılır. Etiketler tek satır, tam ad accessibilityLabel içinde. |
| `PlayerChrome.tsx` | Gerçek giriş bu katmanı kullanıyor; V2 kontrolleri burada gizli, seçenek panelleri V2'de. Yalnız V2 ölçüsünü düzeltmek gerçek dock'u düzeltmiyor | Aynı saf ölçü modeli gerçek dock'a da uygulandı; TV'de görünür araç adları, güvenli Back konumu, ayrı merkez Play/Pause ve kaydırılabilir dock. Mevcut action/callback modeli kullanılır. |
| `ResponsiveContentNav.tsx`, `FocusButton.tsx` | Hedef genişliği ve uzun etiket için sınır yok | Güvenli kenar ve focus ölçek payı, hesaplanan hedef genişliği, tek satırlı etiket, tam erişilebilir ad, yatay kaydırma. Aktif sekme ile odak ayrımı korunur. |
| `PagedCatalogViews.tsx` | VOD/Series sütunları pencere eşiklerinden geliyor; gerçek liste alanı ve 1500 dp sınırı birbirinden bağımsız | Native TV sütunları listenin onLayout genişliğinden hesaplanır; TV'de eski maxWidth kaldırılır. Live ve grid kenarları korunur. Arama/kategori/sıralama araçları satırda sarılabilir; posterler TV'de contain. |
| `StalkerGoldenMoviesCatalog.tsx` | Ayrı sabit sütun eşikleri ve çıplak poster Pressable | Aynı ölçülen grid hesabı, kararlı poster focus ID, mevcut açma callback'i, native focus çerçevesi; TV'de clipping kapalı. |
| `OptimizedHomeScreenPaged.tsx`, `StalkerMainPage.tsx`, `HomeDiscovery.tsx` | Home kenarları sabit; hero genişliği pencere eksi36; zamanlayıcı hero'yu kaydırıyor | Home güvenli kenarları; native hero gerçek parent genişliğini kullanır; native TV'de otomatik hero ilerlemesi kapalı, telefon davranışı korunur. |
| `useNativeTvCatalogGrid.ts` | Sütun değişimi FlatList'i yeniden mount eder | Aynı ID'nin yeni satırını hesaplayıp sınırlı görünürlük restorasyonu; hedef kaybolduğunda veya scope/odak değiştiğinde iptal. Layout'tan requestFocus çağrılmaz. |

## Ölçüm kuralı

`lib/nativeTvResponsive.ts` React Native dp penceresini kullanır; PixelRatio ile çıkış pikseli üretilmez. Varsayılan yatay overscan %2,5, dikey %3,5; safe-area ile büyük olan ve 8 dp odak payı kullanılır. Testlerde farklı overscan değerleri enjekte edilir. FontScale satır yüksekliği hesabına katılır; yerel Text ölçeklendirmesi ayrıca korunur. Yoğun kontrol satırı, minimum hedefi aşırı küçültmek yerine ScrollView içinde kalır. Back ve merkez Play/Pause bu satırın dışındadır; kanal listesi mevcut dock eylemi olarak erişilir.

## Otomatik matris

| Sanal dp penceresi | Amaç | fontScale | Kenar profilleri | Kontrol sayıları |
|---|---|---|---|---|
| 960×540 | Dar TV penceresi | 0,85 / 1 / 1,3 / 1,6 / 2 | Varsayılan; asimetrik safe-area; 72/40 dp overscan | 3 / 8 / 16 / 24 |
| 1280×720 | Orta pencere | Aynı | Aynı | Aynı |
| 1920×1080 | Geniş pencere | Aynı | Aynı | Aynı |
| 1536×864 | Android tarafından ölçeklenmiş 4K çıkışa örnek dp penceresi | Aynı | Aynı | Aynı |

Bunlar fiziksel cihazların kesin dp değerleri değildir. 4K çıkış 1280×720 dp de raporlayabilir; hesap yalnız gerçek dp penceresini alır.

- 240/240 saf hesap + JS yön/eylem senaryosu: güvenli alan, hedef/ikon minimumu, dikey katman ayrımı, panel sınırı, yatay taşma modu, poster hücresi, uzun Türkçe etiketli doğru OK callback'i, dört yön komşuları, kimlikten satır restorasyonu ve Back önceliği.
- Aynı 240 geometri üretimin `TvFocusPolicy.java` koduna verilir: gezinme, poster dört yön ve bütün dock seçeneklerine gidiş/dönüş.
- Mevcut native JVM odak 33/33, kararlılık 21/21; kumanda 25/25; çıkış 6/6; inspector 35/35.
- Telefon/tablet ve TV Preview: TV Preview 32/32, adaptif navigasyon 16/16, tablet 11/11, katalog grid ve Home hero sözleşmeleri.
- Xtream/M3U/Stalker katalog parity, provider-switch, paging/persistence ve live queue regresyonları; TypeScript ve console guard. Eski Stalker kaynak sözleşmesi, native ölçülen sütun dalını kabul ederken telefon eşiklerini denetlemeye devam eder.

## Kanıt sınırı ve fiziksel kabul

Bu ortamda Android cihaz/emülatör üzerinde render veya fiziksel kumanda çalıştırılmadı. Matris, gerçek font gliflerinin taşmasını, Android `requestFocus`/`requestRectangleOnScreen`, sanallaştırma zamanlamasını, firmware overscan'ini veya Homatics key event teslimini simüle etmez. JVM testi gerçek yön seçme algoritmasını çalıştırır; cihaz üzerinde odak alınabildiğini kanıtlamaz. Telefon/tablet kontrolleri de otomatik regresyondur, yeni fiziksel cihaz testi değildir.

Homatics'te her dp/font/kenar değişikliğinden sonra nav → içerik → player → seçenekler → Back akışı; ilk/son dock hedefinin görünürlüğü; uzun Türkçe başlık; poster odak halkası; scroll ve sütun değişiminden sonra aynı ID; kanal listesinin erişimi kontrol edilmelidir. Bu doğrulama tamamlanmadan Native TV Physical PASS yoktur.
