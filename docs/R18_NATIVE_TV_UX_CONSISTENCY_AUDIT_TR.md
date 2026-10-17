# LegendStream XPlayer — Native TV UX Tutarlılık Denetimi

Tarih: 2026-10-16  
PR: #138, branch: `feature/r18-native-tv-premium-ux`  
İncelenen başlangıç HEAD: `0cf077ddb60d387e7dc05067b9e8f4c476704524`

## Kapsam ve kanıt standardı

Kaynak kod bazlı denetim. Gerçek Homatics 4K V2 fiziksel testi yapılmadı. Statik kod incelemesi odak navigasyonunun fiilen doğru çalıştığını veya kumanda olaylarının tekrarlanmadığını kanıtlamaz. Quality PASS de fiziksel kabul değildir.

## 1. Ana navigasyon ve dört içerik türü

- `components/navigation/ResponsiveContentNav.tsx`: TV sekmeleri `nav:{key}` biçiminde kararlı ID, `accessibilityState.selected` ve `onFocusChange` kullanıyor. Aktif sekme için secondary/ghost varyantı mevcut. Fiziksel focus `FocusButton` üzerinden beyaz çerçeveyle ayrıca sunuluyor.
- Aynı bileşende önce tüm sekmeler tek `navigationFocusedRef: boolean` durumunu paylaşıyordu. Bir sekmenin blur olayı başka sekmenin focus olayından sonra geldiğinde ref yanlışlıkla false kalabiliyordu. Düzeltme: anahtar bazlı `Set<string>` ile kayıt; ilgili Back koşulu Set'in boş olup olmadığına bakıyor.
- `components/home/HomeDiscovery.tsx`: `home:live`, `home:movies`, `home:series` odak hedefleri var; Home hero ve shelf kartlarında da focus ID kullanılıyor.
- `components/catalog/PagedCatalogViews.tsx`: Live için `live:{id}`, VOD için `vod:{stream_id}`, Series için `series:{id}` ve kategori çekmecesinde ayrı scope var. Ancak tam D-pad komşuluk grafiği ile scroll/restorasyonun gerçek Android davranışı fiziksel test gerektiriyor.

## 2. Aktif sekme / fiziksel odak / seçili içerik

- Aktif sekme: `accessibilityState.selected` ve nav varyantı.
- Fiziksel odak: `FocusButton.tsx` ile `TVPreviewPressable` çerçevesi; katalogda beyaz kenarlık ve koyu mavi yüzey.
- Seçili kategori / sıralama: `PagedCatalogViews.tsx` içinde active/selected alanları.
- Kalan risk: seçili ve odaklı durumların tüm ekran ve modal varyantlarında aynı görsel sözleşmeyi kullandığı henüz otomatik görüntü/cihaz testiyle doğrulanmış değil. Seçili öğe ile fokusu aynı renk/çerçeveye bağlamama ilkesi korunmalı.

## 3. Oynatıcı kontrol erişimi

- `components/player/PlayerChromeV2.tsx` canlı kanal listesi, önceki/sonraki kanal, görüntü oranı, döndürme, altyazı, ses, codec, isteğe bağlı PiP ve indirme eylemleri sunuyor.
- Native TV için responsive dock, kaydırılabilir yatay menü, geri butonu ve panel kapatma eylemi bulunuyor.
- `components/player/PlayerRemotePressable.tsx` player scope, görünür focus ve focuslanan eylemin erişilebilir adını sunuyor.
- Risk: kaydırılabilir dock'un son öğesine fiziksel D-pad ile gerçekten gidilmesi, kontrol etiketinin tüm ekranlarda görünmesi ve panelden çıkış cihazda ayrıca doğrulanmalı.

## 4. Okunabilirlik, poster, kategori ve metin

- `lib/nativeTvResponsive.ts`, `useNativeTvCatalogGrid.ts` ve player layout uyarlamaları ekran boyutuna göre ölçü hesaplıyor.
- `PagedCatalogViews.tsx` TV'de poster `resizeMode=contain` kullanıyor; başlıklar en fazla iki satır.
- Kategoriler ve sıralama kontrolleri TV için flexWrap içeren düzen kullanıyor.
- Kalan risk: çok uzun Türkçe içerik adları, missing poster, fontScale ve gerçek TV metin rasterizasyonu fiziksel/görsel doğrulama gerektirir.

## 5. Inspector açık/kapalı davranışı

- `components/tvPreview/TVRemoteInspector.tsx`: görüntü katmanında `pointerEvents=none`, `focusable=false`, `accessible=false` mevcut; normalde odak almamalı.
- Önce panel 360/560 dp sabit genişlikteydi. Düzeltme: kullanılabilir pencere genişliği/yüksekliği üzerinden sınırlandırma.
- Inspector'ın gerçek native odak sahipliliğini değiştirmediği kod niyetidir; açık/kapalı karşılaştırmalı cihaz testi yapılmadı.

## Kod düzeltmeleri

1. `ResponsiveContentNav.tsx`: çoklu sekme odak takibinin tek boolean yerine ID Set'i üzerinden tutulması.
2. `TVRemoteInspector.tsx`: overlay genişlik ve yükseklik üst sınırlarının pencereye göre hesaplanması.

## Açık kabul kapıları

- Exact-SHA Quality çalışması yeni HEAD'de doğrulanacak.
- Android TV gerçek fiziksel D-pad odak grafiği, Back, render sonrası focus restorasyonu ve Inspector A/B testi bekliyor.
- Homatics fiziksel sonuç **FAIL / yeniden test bekleniyor**; otomatik Quality PASS sonucundan Physical PASS türetilmeyecek.
