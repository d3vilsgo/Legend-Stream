# LegendStream Elite V2 — Nihai Görsel Sözleşme

## Karar ve kapsam

Onaylanan yön: Home = A Cinematic Luxury; Live TV = B Broadcast Elite;
overlay = B bilgi mimarisi + A görsel hafifliği. Yeni konsept üretilmez.
Elite V1 belgeleri ve showcase korunur. Bu belge V2 hedefini tanımlar;
uygulanmış özellikler aşağıda ayrıca belirtilir.

## Ortak marka ve durum dili

- Canvas `#090C10`, metin `#F4F7FA`, ikincil metin `#ADB9C7`, vurgu `#67E8D1`.
- Tam LEGENDSTREAM logo: açılış ve Home marka alanı. Kompakt monogram: dar rail.
- Tek çizgisel ikon ailesi: mevcut Feather. İkonların anlamı değişmez;
  rail odaklandığında bölüm adı görünür olmalıdır. Rail dönüşümü sonraki kesittir.
- Focus gerçek native owner tarafından belirlenir: beyaz sabit kalınlıklı çerçeve.
  Boşta da aynı border alanı ayrılır. Kanal listesinde scale yoktur; kartlarda
  isteğe bağlıdır. Animasyon layout veya focus isteği üretmez.
- Selected kullanıcı tarafından açıkça seçilen kategori/kanaldır: koyu yüzey.
  Her karta check konmaz. Focus başka öğeye taşınabilir; seçim değişmez.
- Active açık bölüm veya gerçekten oynayan kanaldır: turkuaz işaret.
  Seçim veya Focus tek başına oynatma kanıtı değildir. Gerçek playback kimliği
  yoksa kanal için Active işareti gösterilmez.

## Home — bu PR'da sözleşme, üretim dönüşümü yok

Kompakt sinematik hero, dengeli poster rafları, farklı içerik görselleri,
minimal metin, ince rail, rafine boşluklar. Hero başlığı en fazla iki satır;
uzun Türkçe başlık tam detayda okunabilir. Hero içerik raflarını bastırmaz.
Devam Et kartında başlık, kalan süre ve progress aynı sıradadır.
Canlı Yayına Dön yalnız gerçek geri dönülebilir oturum varsa küçük bir
modüldür; sahte aktif oturum veya otomatik yayın başlatma yoktur.

## Live TV — hedef ve ilk üretim kesiti

Hedef: rail → kategori → kanal → geniş video/önizleme + Şimdi/Sonraki.
Kanal logosu contain ile gösterilir; eksik/bozuk logo tutarlı TV simgesidir.
Kanal adı program adından güçlü; saatler ikincil ama okunabilirdir.
Uzun metinler satır sınırıyla kırılır; tam ad accessibilityLabel'da korunur.

İlk kesit Native TV'de gerçek provider kategorilerini ve sayfalı kanalları
ortak EliteLiveCatalog üzerinden sunar. Kanal OK ile seçilir; ardından
“Tam ekran izle” mevcut onOpen yolunu çağırır. Sadece Focus gezinmesi
seçimi veya playback'i değiştirmez. Favori ve yenileme mevcut callback'lerdir.
Panel düğmesi kategori/kanal alanını açıp kapatır; aynı düğme mounted kalır.
Bu bir modal değildir: arka hedefleri olan modal overlay eklenmemiştir.

**Gömülü video preview mevcut kaynakta yoktur.** Sağ alan kanal/EPG bilgisidir;
bunu açıkça bildirir. Sahte video, ikinci motor veya player reparent eklenmez.
Gerçek önizleme, video üzeri kanal overlay'i ve bu overlay'in Back sahipliği
ayrı playback yaşam döngüsü kesitine bırakılır. İlk kesit hedefin tamamı değildir.
Mevcut üst navigasyon korunur; yeni rail henüz uygulanmamıştır.

## Responsive, tipografi ve katmanlar

Piksel çözünürlüğü değil ölçülen RN dp alanı kullanılır. FontScale,
safe-area ve overscan hesaba katılır. Geniş alanda sütunlar; dar veya büyük
fontlu alanda listeler üstte, kaydırılabilir bilgi alanı alttadır. Liste ve
kategori bağımsız kayar; sınırsız kanal sayısı View.map ile çizilmez.
Bilgi alanı küçüldüğünde eylemler ScrollView ile erişilebilir kalır.
Başlangıç kanal yazısı 20dp, ikincil EPG 17dp; sistem font ölçeği korunur.
Bu değerler fiziksel üç metre kabulü değildir.

Overlay yüzeyleri ayrı RGBA arka planlarıdır: dış yüzey .72, bilgi .92,
Focus satırı opak koyu. Bunlar bölgesel kontrast katmanlarıdır;
video parlaklığını ölçen dinamik opacity algoritması değildir. Metin/ikonlara
panel opacity uygulanmaz. Blur zorunlu değil; düşük maliyetli scrim öncelikli.
Gerçek video üstü uygulamada beyaz/hareketli yayın kontrastı ayrıca ölçülür.
Bu PR'da yüzeyler katalog üzerinde kullanılır; video kontrastı kanıtlanmaz.

## Preview ve Fullscreen Back durum sözleşmesi

| Bağlam                      | Back sonucu                                       | Olay sahibi          |
| --------------------------- | ------------------------------------------------- | -------------------- |
| Gelecek Live preview paneli | En üst etkileşim paneli kapanır; yayın devam eder | Katalog panel sahibi |
| Preview, panel kapalı       | Geçerli katalog üst seviyesine döner              | Katalog navigasyonu  |
| Fullscreen seçenek paneli   | Yalnız en üst panel kapanır                       | Player               |
| Fullscreen kontroller       | Kontroller gizlenir                               | Player               |
| Fullscreen yalnız video     | Açıldığı kategori/listeye çıkar                   | Player exit          |
| Katalog geri dönüşü         | Aynı geçerli ID ve scroll konumu restore edilir   | Native scope restore |

Back iki bağımsız handler ile iki kez ilerlememelidir. Player sahibi varken
katalog Back tüketmez. Görünmez/eski hedef restore edilmez; key yoksa rastgele
komşu seçilmez. Panel animasyonu veya zamanlayıcı focus isteği üretemez.
Preview kapatma uygulama kapatma değildir. Bu tablo hedef sözleşmedir;
mevcut fiziksel player exit ve hidden focus loop sorunları çözülmüş değildir.
Bu görsel kesit Player/Back, orientation veya native input kodunu değiştirmez.

## Fiziksel kabul ve sonraki kesit

Homatics 4K V2: Live aç → kategori → kanal seç → Tam ekran izle → OK ile
kontroller → seçenek paneli → Back paneli kapat → Back kontrolleri gizle →
Back katalog → aynı kategori/kanal odağı ve scroll. 60 saniye tuşsuz bekle;
Inspector açık/kapalı iki tur yap. Tek basış, uzun basış ve bırakma sonrası
kararlılığı; son sayfaya scroll ve yenileme; logo/EPG yokluğunu da dene.

Otomatik testler gerçek Android renderer, firmware, kumanda veya video
sürekliliğini kanıtlamaz. Native TV Physical FAIL devam eder.
Sonraki küçük ayrı PR: exact-source Player Back event delivery ve native
restore döngüsü incelemesi; görsel değişiklik içermeyen düzeltme ve fiziksel
kanıt. Sonrasında mevcut tek playback yüzeyiyle gerçek preview yaşam döngüsü.
Merge, retarget, close, force-push yasaktır; PR'lar Draft kalır.
