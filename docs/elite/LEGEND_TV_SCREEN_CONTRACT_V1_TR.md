# LEGEND TV SCREEN CONTRACT — V1

## Ortak ekran iskeleti

TV: sol dar rail → içerik başlığı/bağlam → içerik alanı. Rail seçimi onPress ile açık bölümü değiştirir; onFocus yalnız görsel odaktır. Sağ/Sol içerik ve rail arasında ölçülen komşuya gider. Rail en üstüne/altına wrap yapmaz; eksik hedefte rastgele seçim yoktur. Uzun label genişleme panelinde tam okunur. Ayarlar da diğer bölümler kadar erişilebilir olur.

Mobil: kompakt yatay/bottom bölüm navigasyonu, dokunma alanları ve portre uyumu. Tablet: kullanılabilir alana göre yatay/iki kolon; telefonun landscape dönüşü otomatik TV değildir. TV Preview sanal D-pad ile ayrı kabul edilir.

| Ekran | Bilgi sırası | Etkileşim ve geri dönüş | Boş/yükleniyor/hata |
|---|---|---|---|
| Home | Kompakt hero, Devam Et, Favori Kanallar, Son İzlenenler, Filmler, Diziler, Canlı Kategoriler | Hero kendi kendine odak/scroll değiştirmez; odaklanan satır görünür. Devam Et geçerli provider-scoped kayıtla açılır. | Eksik satır gizlenir veya tek anlamlı boş durum; tüm Home bloklanmaz. |
| Live TV | Kategori → kanal logo/ad/şimdi → oynatma bağlamı | TV genişliğinde liste + isteğe bağlı preview; preview motoru yeniden mount edilmez. Tam ekran player'a OK. Kategori paneli ayrı scope. | EPG yoksa “Program bilgisi bulunmuyor”; sonsuz spinner veya sahte program yok. |
| Filmler | Poster → başlık/yıl → detay → Oynat/Devam Et | Kartta aşırı zoom yok. Detayda tam başlık, özet, varsa süre/tür; tekrar eden placeholder metadata yok. Back aynı poster kimliğine döner. | Eksik poster markalı oranlı fallback; hata diğer kartları kapatmaz. |
| Diziler | Poster → detay → sezon → bölüm → oynatma | Sezon seçimi açık, bölüm numarası/takip durumu tutarlı. Back bölüm → sezon → detay → katalog. | Sezon yok ve bölüm yok durumları ayrı mesajlanır. |
| Player | Video → temel dock → gelişmiş seçenek paneli | Back/Exit, Play/Pause ve kanal listesi kolay erişilir. Live'da önceki/sonraki; VOD'da seek/progress. | Süre bekleniyorsa seek açıklamalı disabled. Destek yoksa kalite/PiP düğmesi sahte işlev sunmaz. |

## Home prototipi

Özgün, örnek “Kuzeyin Ötesinde” illüstrasyonlu hero; gerçek yayın veya lisanslı içerik iddiası yoktur. Showcase'da tüm Home satır başlıkları örnek fixture'larla gösterilir. Live satırı logo monogramı, kanal adı, Now/Next ve program ilerlemesini gösterir; üçüncü örnek EPG'sizdir. Örnek kanal seçimi video başlatmaz.

İlk prototip gerçek film detayını, sezon/bölüm player handoff'unu veya provider sorgusunu uygulamaz. Bu akışların sözleşmesi burada tanımlanır; ayrı küçük PR'larla gerçekleştirilir.

## Player eylemleri

Mevcut `PlayerChrome.tsx` / `PlayerChromeV2.tsx` callback'leri korunur: play/pause, exit, önceki/sonraki, content paneli, seek, audio, subtitles, fit, mevcut codec seçimi, PiP/rotate/download yetenekleri. Yeni oynatma motoru/state modeli yoktur. Mobil rotation TV'de normalde gizlenir; pencere/cihaz politikası uygunsa “Ekran yönü cihaz tarafından yönetiliyor” gerekçesi sunulur. Codec seçimi, mevcut implementasyonda gerçek seçenek neyse onunla adlandırılır; bitrate/kalite API'si varmış gibi gösterilmez.

## Provider yetenek sınırları

- Xtream: mevcut kind paging/search/sort ve kimlikler korunur; “son eklenen” sıralama yalnız mevcut destekle sunulur.
- M3U: grup ve içerik sınıflandırması korunur; Xtream kategori/EPG/metadata şeması varsayılmaz. Eksik tarih/özet gizlenir.
- Stalker: provider-global kategori semantiği, session/create_link ve bölüm hiyerarşisi korunur. `stalkerProductEpg.ts` ürün yolu ile tanı probe dosyaları farklıdır; program ancak gerçek eşleşmiş, geçerli veri varsa gösterilir.
- Showcase yetenekleri gerçek provider desteğinin kanıtı değildir.

## Kabul akışı

Önce Live → kategori → kanal → player → seçenek paneli → Back → kontroller → Back → katalog → aynı ID. Her yön/OK için inspector'da input/focus/action ayrılır. Player'dan çıkılamama ve gizli kontrollerde focus döngüsü çözülmeden Home veya grid migrasyonu fiziksel kabul alamaz.
