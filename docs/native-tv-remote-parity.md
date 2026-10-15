# Native TV kumanda ve player parity

Kaynak: PR #135, `e49e586107f6fc111b63791769e8d1f449c9a3e0`.
Base: `feature/r18-native-tv-universal-apk`. Homatics 4K V2 / Universal APK #487 fiziksel sonucu FAIL olarak korunur. Bu değişiklik fiziksel kabul değildir.

## Kaynak bulguları ve düzeltme

- `TVPreviewFocus.tsx`: fiziksel odak çerçevesi ile aktif sekme ayrı tutulur. Native scope ve son odak kimliği provider ömrüyle sınırlıdır; sağlayıcı değişiminde ProductShell delegate'i zaten remount olur. Kategori modalı mevcut scope'u kullanır.
- `FocusButton.tsx`, `ResponsiveContentNav.tsx`: navigation hedefleri mevcut native odak stilini korur; player Back sahipliği varken navigation Back tüketmez.
- `OptimizedHomeScreenPaged.tsx`: TV player katalog bileşenlerini unmount ediyordu. TV'de katalog player altında tutulur; kategori, yüklenmiş sayfalar, Series detayı ve scroll korunur. Telefonun mevcut ayrı player render yolu korunur. StalkerMainPage zaten overlay kullanıyordu.
- `NativeTVFocusScope.tsx`: Android ViewGroup descendantFocusability ile bütün arka plan hedefleri engellenir. Yalnız `focusable=false` yeterli değildir: React Native 0.81.5 ReactViewManager erişilebilirlik için native focusable bayrağını kaldırmaz.
- `CompatibilityVideoPlayerV2.tsx`: panel → kontroller → çıkış sırası TV'ye uygulanır. Katalog Back listener'ları ortak sahipliği kontrol eder. İlerleme kaydetme hatası çıkışı engellemez. TV kontrolleri kendiliğinden kaybolmaz; Back ile kapatılır.
- `PlayerChrome.tsx`, `PlayerChromeV2.tsx`: aynı action callback'leri, aynı VLC, aynı track/codec/content panelleri kullanılır. Yeni playback engine veya provider protokol yolu yoktur. Büyük TV hedefleri, görünür odak etiketi ve beyaz odak çerçevesi eklenir.
- `PlayerGestureLayer.tsx`: TV'de mevcut enabled prop'u üzerinden dokunmatik katman devre dışı bırakılır. Dosyası değiştirilmez.
- `VlcPlaybackSurface.tsx`: mevcut oynatma, track, fit, codec, diagnostic/redaction ve provider URL çözümleme akışı değiştirilmez.
- Native köprü yalnız gerçek Android TV uiMode ve aktif player sırasında key event yakalar. Kontroller görünürken D-pad/OK Android FocusFinder'a bırakılır. Back native köprü tarafından tüketilmez. Yakalanan key-down'un key-up'ı da tüketilir; çift OK önlenir.
- Kategoriler için TV'de açık bir kumanda hedefi eklenir; swipe zorunluluğu kaldırılır. Sıralama ve favoriler de kararlı kimlikli, görünür odaklı hedeflerdir.
- Canlı katalog D-pad ile scroll edildiğinde onScrollBeginDrag gelmediği için pagination engeli vardı; TV scroll offset ilerlemesi de kullanıcı kaydırmasını işaretler; ilk render sırasında sayfalama engeli korunur. Native listelerde clipping kapatılır; sanallaştırma/batch sınırları korunur. Android ScrollView requestChildFocus odaklanan child'ı görünür alana kaydırır.

## Mobil eylem → TV eşlemesi

| Mevcut mobil fonksiyon | Native TV erişimi / kumanda | Odak ve doğrulama |
|---|---|---|
| Kontrolleri aç/kapat | Gizliyken OK; görünürken Back | Kontroller açıldığında Play/Pause tercihli hedef |
| Play/Pause | Odakta OK; fiziksel media Play/Pause | Aynı onTogglePause; ayrı Play/Pause tuşları idempotent |
| Çıkış/stop | Çıkış simgesinde OK, media Stop veya Back sırası | Panel, kontroller, sonra exitPlayer |
| Önceki/sonraki kanal | Dock OK; kontroller gizliyken Yukarı/Aşağı; media previous/next | Aynı onMoveRelative ve queue sınırları |
| Kanal/içerik listesi | Liste simgesinde OK | Mevcut FlatList paneli; seçili satıra başlangıç kaydırma |
| VOD seek/progress | Geri 10 / ileri 15 düğmelerinde OK; kontroller gizliyken Sol/Sağ | Aynı seekBy; canlıda seek yok; duration yoksa handler işlem yapmaz |
| Ses parçası | Ses simgesi → satırda OK | Aynı track ID; boş panel açıklaması ve kapatma hedefi |
| Altyazı | CC → satırda OK | Kapalı ve mevcut gömülü parçalar; olmayan track açıklanır |
| Görüntü oranı | Fit simgesinde OK | Aynı fit/full/original/16:9/4:3 döngüsü |
| Codec | Codec simgesi veya cihaz Menu tuşu | Mevcut AUTO/HW/SW paneli |
| EPG şimdi/sıradaki | Kontrollerle birlikte mevcut InfoCard | Mevcut epgNow/epgNext verisi; Stalker probe ürün EPG sayılmaz |
| Oynatıcı bilgisi | Kontrollerle birlikte mevcut durum/teknik bant | Codec, çözünürlük, FPS, mevcut hata/toast panelleri |
| İndirme | Mevcut allowDownload izin veriyorsa dock OK | Mevcut download callback ve durum |
| PiP | Mevcut pipSupported izin veriyorsa dock OK | Aynı PiP callback; cihaz desteği fiziksel testte doğrulanır |
| Ekranı döndür | TV'de gösterilmez | Sabit TV panelinde cihaz dönüşü anlamlı değildir |
| Parlaklık kaydırma | TV'de dokunma hareketi yok | Panel parlaklığı TV/monitörün kendi ayarıdır |
| Ses kaydırma | TV/AVR kumandasının ses tuşları | Android sistem ses tuşları köprüde yakalanmaz |
| Dokunarak progress oranı seçimi | TV'de focus dışı gösterge | Kumandadaki süreli seek hedefleri kullanılır |

## Otomatik doğrulama ve sınır

`nativeTvRemoteScenarios.ts`: Back önceliği, çoklu sahiplik temizliği, media tuşları, bağlama göre seek/kanal/reveal ve odak komşuluğu için davranış testleri. Mevcut TV Preview 32 senaryo ve Universal APK kontratı korunur. Mevcut katalog/navigation assertion'ları korunur; yalnız Native TV focusable source kontratı scope mimarisine uyarlanmıştır; assertion silinmez.

Bu testler fiziksel native focus veya VLC oynatma ispatı değildir. Gerçek cihazdaki odak komşuluğu, sanallaştırma sınırları, Menu tuşunun firmware tarafından iletilmesi, track seçimi ve sağlayıcı uyumu aşağıdaki fiziksel turda doğrulanmalıdır.

## Homatics 4K V2 fiziksel turu

1. Universal APK'yı yükle; hesap sırrı veya provider URL'si içermeyen kayıt al.
2. Home'da beyaz odağı gör; aktif sekme ile fiziksel odak farklı hedeflerken ayırt et.
3. Xtream Live'da satır/sütun ve favori hedefleri arasında dört yön gez; ekran altını ve sonraki sayfayı geç.
4. Kategori çekmecesini aç; arka planın odak alamadığını ve Back ile önceki öğeye dönüldüğünü doğrula.
5. VOD ve Series posterleri, sezonlar ve bölümler arasında gezin; görünür alana kaydırmayı kontrol et.
6. Bir kanalı aç; Play/Pause, önceki/sonraki kanal, liste, ses, altyazı, fit ve codec hedeflerine D-pad ile eriş.
7. Kontroller açıkken Back: yalnız kontroller kapanmalı. OK: kontroller açılmalı.
8. Kontroller gizliyken Yukarı/Aşağı kanal değiştirmeli; Sol/Sağ kontrolleri açmalı. Media Play/Pause ayrıca çalışmalı.
9. Kanal listesi panelinde seçili kanal ve uzak bir satır seçimi çalışmalı. Panelde Back yalnız paneli kapatmalı.
10. Audio/CC boşsa açıklamayı gör; doluysa farklı parçayı seç ve gerçekten uygulandığını doğrula.
11. Menu sunan kumandada codec panelini aç; fit ve AUTO/HW/SW değişimini kontrol et.
12. Kontroller gizliyken Back ile tamamen çık; önceki kanal odağı, kategori ve scroll konumunu doğrula.
13. VOD aç; progress, -10/+15 seek, media pause, panel ve çıkış akışını tekrarla.
14. Series bölüm aç; çıkışta aynı sezon/bölüm durumunu doğrula.
15. M3U ve Stalker üzerinde ayrı ayrı Live, kullanılabilir VOD/Series akışlarını tekrar et; sağlayıcı davranışlarını birbirine genelleme.
16. Telefon player'ında dokunma, seek, ses, dönüş, panel, Back ve çıkış regresyonlarını kontrol et.
17. Telefon TV Preview'da Home/Live/VOD/Series sanal D-pad ve kategori scope regresyonunu kontrol et.
18. ARM64 + ARMv7 LibVLC dizinleri, paket, imza ve Universal versionCode mevcut APK workflow'unda ayrıca zorunludur.

Son karar: Homatics fiziksel sonucu gelene kadar NATIVE_TV_PHYSICAL_PENDING; hiçbir PR merge edilmez.
