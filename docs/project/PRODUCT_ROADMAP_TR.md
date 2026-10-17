# LegendStream XPlayer — Tek Ürün Yol Haritası

## Hedef ve çalışma politikası

Tek uygulama; telefon, tablet, Android TV/Google TV/TV Box ve TV Preview için aynı Legend Elite V2 marka, içerik ve temel davranış sözleşmesi. Ekran geometrisi ve giriş yöntemi uyarlanır. Xtream, M3U ve Stalker resolver/oturum mekanizmaları ayrı kalır.

Proje aşaması: **GLOBAL INTEGRATION & FEATURE COMPLETION**. APK ve fiziksel kabul, ana geliştirmeler ile otomatik doğrulamalar bittikten sonra bütünleşik Release Candidate için kullanıcı onayıyla başlar. Quality PASS ve Physical PASS ayrı kayıtlardır.

## Dilimler

| Dilim | Kapsam | Durum / çıkış kapısı | Sorumlu hat |
|---|---|---|---|
| U1.1 | #142 kaynak ağacı + #138'in eksik üç Native TV onarımı | Bu branch; exact-HEAD Quality ve Draft PR ile izlenir. Ürün bütünü tamamlandı değildir. | U1 kaynak entegrasyonu |
| U1.2 | #120 hijyen, #121/#126 katalog grid, #122/#127 mobil/tablet/Preview Hero, #124/#125 alternatiflerinin semantik uzlaşması | Açık; mevcut TV onarımını ezmeden, küçük ayrı kabul dilimleri | Ortak sunum ve araç zinciri |
| U1.3 | #130 performans gözlemi + #131 cache-first refresh | Açık; callback/iptal/kimlik/redaksiyon regresyonlarıyla üç provider ayrı ayrı | Provider/cache/performance |
| U1.4 | Gerçek Elite Home, Live touch/Preview parity, Player/kanal overlay, Series Info ve Home→Film Info | Açık; aynı marka/action sözleşmesi, cihazlara uyarlanmış düzen | Elite ürün parity |
| U1.5 | TMDB canlı bağlantı | LIVE BLOCKED; onaylı HTTPS hosting, güvenilir session issuer, sunucu secret bağlantısı, atıf ve gerçek uçtan uca kanıt gerekir | Metadata/backend |
| RC | Bütünleşik otomatik doğrulama + tek kaynaklı RC kabulü | Henüz başlamadı; fiziksel test yalnız kullanıcı onayıyla | Release kabulü |

## Açık PR işlerinin korunması

| Kaynak | U1.1 kapsamı | Sonraki iş |
|---|---|---|
| #120 | Yalnız scripts/tsconfig.json root typecheck onarımı alındı; hijyen PR'ının tamamı alınmadı | Node/pnpm pin, kullanılmayan bağımlılıklar, API trust-proxy, ek test kapıları ve belgeler tek tek uzlaştırılmalı |
| #121 | Responsive VOD/Series görsel kolu alınmadı | Film Info girişlerini ve güncel Native ölçüleri koruyarak grid farklarını seç |
| #122 | Eski mobil landscape Hero düzeltmesi alınmadı | #127 ile tek mobil/tablet/Preview bütçe sözleşmesi |
| #123 | main'deki presentation/orientation temeli miras | Sonraki #129 politikasının fiziksel kabulü devraldığı varsayılmaz |
| #124 | Ayrı kompakt landscape nav kolu alınmadı | #133 ile davranış seçimi; telefon katalog landscape politikası açık |
| #125 | Özgün branch bütünüyle entegre sayılmaz; evrilmiş token/helper'lar #132 üzerinden kısmen miras | Ortak semantic token ve gerçek ekran kullanım haritası |
| #126 | computePosterGridLayout gerçek katalog bağlantısı bu dilimde taşınmadı | Tablet/telefon grid ve scroll restorasyonu |
| #127 | Height-bounded mobil/tablet Hero kolu alınmadı | Native #138 modelini koruyan sunum birliği |
| #128/#129/#132–#137 | #142'nin atalarından gelen kaynak mirası korunur | Kabul borçları FEATURE_PARITY_MATRIX ve OPEN_ISSUES içinde |
| #130/#131 | Performans/cache ayrı dalı alınmadı | Ölçüm + cache-first semantik entegrasyonu |
| #138 | Eksik üç commit cherry-pick ile taşındı | Fiziksel FAIL kaydı açık; yeni birleşik kaynak NOT TESTED |
| #139–#142 | Elite Live, Film Info, matcher/cache/proxy kaynakları korunur | Elite ekran parity ve TMDB LIVE BLOCKED kapanmadı |

Yeni görev önce bu dilimlerden birine bağlanır. Önceki görev sessizce kapanmaz: geliştirme, Quality, fiziksel kabul, açık kusur ve sonraki eylem ayrı güncellenir. Commit veya Quality tek başına ürün tamamlanması sayılmaz.

Bağlı kayıtlar: [parity](FEATURE_PARITY_MATRIX_TR.md), [kusurlar](OPEN_ISSUES_TR.md), [kabul](RELEASE_ACCEPTANCE_TR.md), [entegrasyon](INTEGRATION_LEDGER_TR.md).
