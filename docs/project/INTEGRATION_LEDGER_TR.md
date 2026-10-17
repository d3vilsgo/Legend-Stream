# U1 Entegrasyon Defteri

## U1.1 kaynak gate — 17 Ekim 2026

| Kaynak | Doğrulanan SHA | Karar |
|---|---|---|
| main | `810adc2f7e82da52d8dd6768fcd5cf1d3040e106` | Değiştirilmedi |
| #138 HEAD | `7591b3ce5d9d5903714749f51ba74ebb48bb3b24` | Yalnız eksik üç commit alınır |
| #142 HEAD | `98423240d1f966388e74aa4249632b1c921b3c4b` | Yeni integration/legendstream-u1 başlangıcı |
| #138/#142 merge-base | `3755a39b48441fd0904d3a40a7a8c77576ee0281` | #142..#138 tam olarak aşağıdaki üç commit |

Branch remote'da yoktu; exact #142 SHA'sından oluşturuldu. Mevcut branch üzerine yazılmadı. Yerel izolasyon ayrı worktree ile yapıldı.

| Sıra | Kaynak commit | Davranış | Çözüm |
|---|---|---|---|
| 1 | `207a78af3603d96436623b23319f69bfc5d59757` | Native row/kolon hareketi, sabit focus border, modal/window input sahipliği, Inspector dispatch alanları | Ayrı `cherry-pick -x`; çatışma yok |
| 2 | `374f80d12264193396c9d6c22cdd76d2019d4068` | Home/Live/Movies/Series region izolasyonu; stale başka ekran hedeflerini eleme | Ayrı `cherry-pick -x`; çatışma yok |
| 3 | `7591b3ce5d9d5903714749f51ba74ebb48bb3b24` | Native Home viewport bütçesi, ilk raf önizleme, Hero/shelf focus ID, görünür hedef scroll davranışı | Ayrı `cherry-pick -x`; Quality.yml otomatik birleşti; hiçbir dosya üstten kopyalanmadı |

Bu üç logical commit'in kaynak mesajları ve `(cherry picked from commit ...)` izi korunur. U1'de eski SHA'ların aynı SHA ile ancestor olması beklenmez; yeni commit kimliği/cherry-pick ilişkisi Git geçmişinden okunur.

## CI ve entegrasyon regresyonu

Quality'ye U1 push/base kapsamı ve checkout sonrası exact SHA eşitliği eklendi. Permissions `contents: read` olarak kaldı. Mevcut Quality kapıları ve APK workflow'ları korunur; U1 için APK tetikleyicisi eklenmedi.

Production `TvFocusPolicy` JVM testine beş U1 sınır senaryosu eklendi: Elite Live'ın stale Home rafını seçmemesi; Film Info içi hareket; modal sınırından kataloğa kaçmama; alttaki Movies hedefinin modal sahipliği alamaması; content scope'ta Live hareketinin korunması. Bunlar Android Dialog'un gerçek event dispatch testi değildir.

Yerel tam workspace typecheck, mobil ve API'yi geçtikten sonra devralınan `scripts/tsconfig.json` içindeki var olmayan `src` girdisinde TS18003 verdi. #120 HEAD `faf0105a87633693161995b8801e0962d168f97c` içindeki yalnız bu küçük onarım seçilerek alındı: mevcut `check-console-usage.mjs` gerçek JS typecheck girdisi oldu; `allowJs/checkJs` açıldı. Bu config kaynakla birebir eşleştirildi; #120'nin geri kalanı entegre sayılmadı. Quality'ye mevcut kontroller kaldırılmadan tam workspace typecheck eklendi.

Normal Git push kimlik doğrulaması bulunmadığı için yayın, GitHub Git-data commit/ref araçlarıyla aynı dosya ağaçları ve kaynak izli mesajlar üzerinden yapılır. Sunucunun ürettiği commit SHA'ları yerel cherry-pick SHA'larından farklı olabilir; her remote tree kimliği yerel doğrulanan tree ile karşılaştırılır. Eski branch/ref geçmişi değiştirilmez, force-push yapılmaz.

Exact final SHA, Draft PR ve Quality run/check bilgileri bu branch'in GitHub geçmişi ve PR Checks kaydında tutulur. Kaynak dosyası kendi commit SHA'sını içeremeyeceği için sahte bir “final SHA” yazılmaz. Her yeni push, önceki yeşil run'ın kabulünü sıfırlar; `QUALITY_EXACT_HEAD` ve run `head_sha` eşitliği gerekir.

## PR hedef kararı

Yeni Draft PR'ın base'i **`feature/r19-tmdb-secure-proxy` (#142)** olur. #142 main'e göre açık stacked çalışmaları içeriyor; main hedefli yeni PR bunları ikinci paralel toplu merge yüzeyi yapardı. #142 base'i U1.1'in üç onarım + CI/test/proje kaydı farkını izole gösterir. Eski #135–#142 PR'larının base/head/durumları değiştirilmez. Bu yeni PR merge yetkisi değildir; bütün U1/main geçişi ayrı kaynak uzlaştırma dilimi ister.

## Koruma kanıtı

#142'nin EliteLiveCatalog, MovieInfoModal, TMDB matcher/cache/proxy ve provider resolver/identity kaynakları bu üç patch tarafından değiştirilmez. Player motoru/oturum çözümlemesi birleştirilmez. Değişen üretim dosyaları yalnız #138'den gelen Native Home, focus target/inspector ve native module davranışlarıdır; sonraki entegrasyon test ekleri ayrıca görünür.

## Açık kayıtlar ve teslim durumu

| Kayıt | Durum | Sonraki eylem |
|---|---|---|
| Üç #138 düzeltmesi | SOURCE_INTEGRATED | Exact-HEAD Quality; Physical NOT TESTED |
| Native TV tarihsel kusurlar | Physical FAIL korunur | Yalnız RC'de onaylı yeniden kabul |
| TMDB canlı | LIVE BLOCKED korunur | Onaylı hosting/issuer/token/atıf ve gerçek bağlantı |
| 14 legacy branch temizliği | 14 SKIP / 0 DELETED / 0 FAILED | Yönetim erişimi ve dependency gate bekler; U1'i bloke etmez |
| #120–#127 | Tam entegrasyon yapılmadı | PRODUCT_ROADMAP ve OPEN_ISSUES'taki ayrı kaynak işleri |
| #130/#131 | U1.1 dışında | Performance/cache semantik uzlaşması |
| U1 geneli | Tamamlanmadı | İlk dilimden sonra araç zinciri + mobil/tablet/Preview grid/Hero parity |

Geliştirme, otomatik doğrulama ve fiziksel kabul ayrı sütunlarla izlenir. Bu ilk kaynak diliminin başarılı olması bütün açık geliştirmelerin tamamlandığı anlamına gelmez.
