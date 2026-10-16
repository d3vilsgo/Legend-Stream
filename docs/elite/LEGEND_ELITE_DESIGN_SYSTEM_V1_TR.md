# LEGEND ELITE DESIGN SYSTEM — V1

Durum: Tasarım sözleşmesi + izole prototip; ürün ekranlarına toplu geçiş onayı değildir.
Hedef: İçerik keşfiyle etkileyen, kullanım kolaylığıyla güven veren, kumandayla kullanıldıkça keyfi artan, premium ve hızlı Android medya deneyimi.

## Kaynak kapısı

- main: `810adc2f7e82da52d8dd6768fcd5cf1d3040e106`.
- PR #138: `3755a39b48441fd0904d3a40a7a8c77576ee0281`, açık/Draft, merged=false.
- Base: `feature/r18-tv-remote-focus-inspector`.
- Bu SHA'nın Quality run ID: `38908602285`, success. APK run ID: `38911591037`, success. Bu sonuçlar fiziksel PASS değildir.
- Tasarım dalı: `feature/r18-legend-elite-design-v1`; doğrulanan PR HEAD'i taban alınır. PR #138 değiştirilmez, kapatılmaz veya merge edilmez.
- Gen2 kaynak değildir. main'de ProductShell provider ayrımı vardır; `lib/design/tokens.ts` main'de yoktur. Native focus/preview katmanları ve responsive token geliştirmeleri açık PR zincirindedir, main özelliği sayılmaz.

## Kimlik

Koyu antrasit canvas, soğuk nötr yüzey, tek baskın turkuaz vurgu. Beyaz focus halkası bir etkileşim göstergesidir; ikinci marka rengi değildir. Hata rengi yalnız hata anlamında kullanılır. Glow, ağır gölge, sürekli animasyon, neon gradyan ve dokunmatik telefon düzeninin TV'de büyütülmesi reddedilir.

| Rol | Token | Değer / kural |
|---|---|---|
| Canvas / yüzey / yükseltilmiş | color.canvas/surface/raised | #090C10 / #12171E / #1C2530 |
| Ana / ikincil metin | color.text/muted | #F4F7FA / #ADB9C7 |
| Vurgu / vurgu üstü metin | color.accent/onAccent | #67E8D1 / #071916 |
| Focus / seçili yüzey | color.focus/selected | #FFFFFF / #263D40 |
| Spacing | space | 4, 8, 12, 16, 24, 32, 48 dp |
| Radius | control/card/panel | 12 / 16 / 24 dp |
| Elevation | base/card/dock/panel/alert | 0 / 2 / 8 / 16 / 24; z-order rolüdür, her platformda aynı gölge değildir |
| Motion | focus/panel/rail | 90 / 160 / 180 ms; reduced-motion'da 0 |
| Focus | width/gutter/scale | Sabit 3 dp border, 8 dp boşluk, scale=1 |
| Minimum hedef | mobile/tablet/tv | 48 / 52 / 64 dp |

Kod otoritesi `lib/design/eliteTokens.ts`; bu sürüm opt-in'dir. Eski `constants/colors.ts`, `premiumDesignTokens` veya `useColors` üzerine yazılmaz. Bileşenlerden palette ait yeni sabit hex değer türetilmez; örnek sanat renkleri fixture verisi olabilir.

## Tipografi ve ikon

Inter Regular/700; tek ikon seti, aynı 24 birim viewBox ve 1,8 stroke. Dolu simge yalnız birincil oynatma ve aktif işaret için. TV body/meta/title 20/16/40 dp; tablet 17/14/34; mobil 15/13/28. Meta metin TV'de 16 dp altına inmez. FontScale etkisi satır ve panel yüksekliğine katılır; metni hedefe sığdırmak için font küçültülmez. Uzun başlık iki satır, yardımcı bilgi bir satır; ayrıntı ekranında tam metin ve erişilebilir tam ad korunur. Kartlara bütün özet metin doldurulmaz.

## Responsive sözleşme

Piksel çıkışı değil React Native dp penceresi + gerçek ölçülen parent alanı kullanılır. Safe-area ve overscan'den büyük olan alınır, focus payı eklenir. TV/Preview genişliğe göre aynı görsel aileyi kullanabilir; fiziksel input mekanizmaları ayrı kalır. Mobil/tablet kimliği yalnız landscape olunca TV'ye dönüşmez; orientation sahibi değişmez.

- İçerik genişliği en çok 1680 dp; daha geniş pencerede ortalanır.
- Poster en çok 240 dp; oran 2:3; grid kalan alanı eşit boşlukla kullanır, kart sonsuz büyümez.
- Hero kullanılabilir yüksekliğin TV'de yaklaşık %32'si, en çok 360 dp; dar/iri font halinde metin aşağı akar, içerik kaydırılır.
- TV rail 76 dp kapalı; açılmış etiketler içerik alanını yeniden daraltan layout değişikliği yerine rail üst katmanında görünür. 720 dp altında yatay navigasyon kullanılır; bu cihaz sınıfını değiştirmez.
- Prototipte yatay içerik satırları; gerçek grid hesap fonksiyonu testlidir, üretime geçiş ayrı PR'dır.

## Durum ayrımı

Focus: fiziksel/klavye odağı, beyaz çerçeve. Selected: seçilen kategori/kanal, nötr renkli yüzey + onay işareti. Active: açık bölüm veya oynayan öğe, turkuaz ince işaret. Üçü aynı anda farklı öğelerde bulunabilir. Hover ve Pressed, Focus olarak raporlanmaz. Disabled hedefin gerekçesi görünür olmalı; sessiz işlevsiz düğme yoktur.

## Kalite sınırı

Kontrast testleri gerçek alpha bileşimini beyaz ve siyah arka planda hesaplar; normal metin ≥4,5:1, focus komşu yüzeye ≥3:1. Blur zorunlu değildir. Sanallaştırma/asset ölçümü önceden kararlı oranla yapılır. Animasyon yalnız opacity/transform; layout her karede değiştirilmez. 60 fps hedefi donanım ölçümü gerektirir; prototip bu sonucu iddia etmez.
