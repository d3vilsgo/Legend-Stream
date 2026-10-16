# LEGEND OVERLAY DESIGN — V1

Overlay video motorunun sahibi değildir. Açma/kapatma source, paused, codec veya provider session state'ini değiştirmez. Zorunlu motor işlemleri mevcut player eylemlerinden gelir.

| Tür | Yüzey alpha | Yerleşim / yaşam süresi | Input / scope |
|---|---:|---|---|
| Kanal bilgi çubuğu | .84 | Alt güvenli alan; en çok iki program satırı; başlangıç 4 sn | Bilgi katmanı; focus almaz, pointerEvents=none |
| Hızlı kanal listesi | .94 | Sağ panel, en çok 560 dp; dar alanda sheet | Tek interaktif scope; seçme mevcut channel switch callback'i |
| Şeffaf EPG | .94 interaktif, .84 bilgi | Geniş pencerede program kolonları; dar alanda şimdi/sonraki liste | Scope aktifken autohide durur; geçerli zaman/kanal eşleşmesi zorunlu |
| Player dock | .94 | Alt güvenli alan, merkez kontrollerle çakışmaz | player-controls; görünür ve gizli durum ayrılır |
| Ses/altyazı/mevcut codec | .94 | Başlık + açıklama + seçilebilir satırlar | Seçili parça onaylı; uygun olmayan seçenek açıklamalı disabled |
| Kanal numarası | .94 | Sağ üst kompakt giriş + aday kanal | Ayrı input buffer; 1,5 sn başlangıç bekleme, OK kesinleştirir, Back iptal |
| Hata/bilgi | .98 hata, .84 pasif bilgi | Kısa açık mesaj; gerekiyorsa Yeniden Dene/Çık | Bloklayan hatada scope; toast odak almaz |

## Görsel ve zamanlama

Yüzey RGB 18/23/30; metin #F4F7FA, ikincil #ADB9C7. Opacity bütün panel View'ına uygulanmaz; arka plan alpha ile çizilir, metin opak kalır. Beyaz video üstünde dahi kontrast testi yapılır. Blur kapalı varsayılır; düşük donanımda yarı saydam dolgu yeterlidir. Panel 160 ms opacity/translation, reduced-motion=0; ekran ölçümünü kare başına değiştirmez.

Pasif bilgi ile interaktif panel aynı şey değildir. EPG, ses, altyazı veya kanal listesi açıkken dock'un autohide zamanlayıcısı iptal edilir. Panel kapanınca eski timeout kaldığı yerden devam etmez; etkileşim sonrası yeni süre başlar. Hata panelinin üzerinde kısa toast gösterilerek eylemler örtülmez.

## Sahiplik ve restore

1. Açılmadan önce gerçek opener focus ID ve scope kaydedilir.
2. Tek panel scope'u aktif olur; arka hedefler focusable/input ve erişilebilirlik ağacında devre dışı kalır.
3. İlk odak mevcut seçili geçerli satıra, yoksa açıkça belirlenmiş Kapat hedefinedir; rastgele fallback yoktur.
4. Back yalnız üst paneli kapatır. İkinci bir handler aynı fiziksel olayı tekrar uygulamaz.
5. Kapanınca kayıtlı ID hâlâ mount/visible/enabled ise restore edilir. Yoksa rastgele başka karta OK yönlendirilmez; scope sahibi belirlenmiş güvenli hedefi kullanıcıya görünür biçimde sunar.
6. Layout/render yalnız ölçümü günceller; her render requestFocus çalıştırmaz.

Showcase paneli bir tasarım örneğidir: örnek kanal seçimi, kapatma ve opener restore davranışı. Gerçek video ve EPG motoruna bağlı değildir; donanımda native scope entegrasyonu ayrı doğrulanacaktır.
