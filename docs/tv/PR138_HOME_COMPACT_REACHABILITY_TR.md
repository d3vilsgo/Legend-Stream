# PR #138 — kompakt Native TV Home Hero ve raf erişimi

## Kaynak kapısı ve durum

Başlangıç remote HEAD: `374f80d12264193396c9d6c22cdd76d2019d4068`. Exact-SHA Quality `39033219796` SUCCESS doğrulandı. Açık/Draft #138 üzerinde devam edildi. #139 referans HEAD `aa94b587a3b303cd5d25b656b679ad79b89e15ef` üzerindeki `docs/elite/LEGEND_ELITE_V2_FINAL_VISUAL_CONTRACT_TR.md` okundu: kompakt sinematik Hero, en fazla iki satır başlık, içerik raflarını bastırmayan düzen ve sabit beyaz focus sözleşmesi esas alındı. #139–#142 HEAD/branch'leri değiştirilmedi. Final SHA ve yeni exact-SHA Quality bağlantısı PR sonuç bölümünde verilir.

**Native TV Physical FAIL devam ediyor.** Kullanıcı bulgusu Homatics ve eski APK #504'e aittir. Son odak düzeltmeleri dahil yeni HEAD için henüz fiziksel kabul yoktur. Eski ve başlangıç kaynaklarında aynı büyük Hero oranı bulunması P1 kaynak kusurunu doğrular; tüm fiziksel DOWN sorunlarının tek sebebinin bu olduğu iddia edilmez.

## Dosya → Kanıt → Kök neden → Düzeltme → Test → Kalan risk

| Dosya (app köküne göre) | Kanıt ve kök neden | Düzeltme | Test | Kalan risk |
|---|---|---|---|---|
| `components/home/HomeDiscovery.tsx` | `homeHeroCard` genişlik/2.25, min190/max520; boş durum max420; caption paddingTop70. Native pencere yüksekliği ve gerçek içerik viewport'u hesapta yok. Araya giren 76dp bölüm kartları + marjlar rafı aşağı itiyor. | Sadece native TV'de ortak ölçülen yükseklik. Görselli/boş/yükleniyor aynı kompakt geometri. Caption boşluğu12; kontrollü 1–2 satır başlık; tam başlık accessibilityLabel'da. Dar/yüksek fontlu alanda ikincil metadata gizlenebilir. TV'de tekrar eden bölüm kartları rafların sonuna taşınır; eylemler silinmez. | 68 saf geometri ve 33 gerçek Hero bileşeni host-render senaryosu; mobil Hero oranı korunur. | Android glyph/font ölçümü ve görsel cover kırpması fiziksel test ister. Yeni backdrop verisi veya TMDB eklenmez; mevcut görsel center-cover kalır. |
| `components/OptimizedHomeScreenPaged.tsx`, `components/StalkerMainPage.tsx` | Gerçek Home dikey ScrollView header/nav altında flex alan; Home bu alanın yüksekliğini almıyordu. | ScrollView onLayout'tan native viewport yüksekliği Home'a aktarılır. Böylece başlık/nav/safe-area tarafından tüketilen alan tekrar ekran yüksekliği sanılmaz. State aynı ölçüde değişmez; onLayout focus istemez. | TypeScript, mevcut Preview/nav/orientation/provider testleri; render + geometri. | İlk layout öncesi tahmini nav bütçesi kullanılır; ölçüm gelir gelmez güncellenir. Beklenmedik sistem banner'ı veya çok küçük pencere ayrıca denenmeli. |
| `lib/design/nativeTvHomeLayout.ts` (yeni) | Sabit en/boy oranı kısa TV penceresini dolduruyor. | Başlangıç hedefi kullanılabilir yüksekliğin%33'ü; metin/border/fontScale ve ilk raf başlığı + en az72dp kart görünümü önceliklidir. Üst sınır320dp. Gerçek ScrollView ölçümü nav'ı zaten dışlar; parent top22dp ve bottom overscan ayrılır. | 960×540,1280×720,1920×1080,1536×864 dp; font1/1.3/1.6/2; safe-area/overscan; invalid viewport fallback:68/68. | Son derece küçük viewport veya daha büyük fontta bütün hedefler aynı anda sığamayabilir. `shelfBudgetMet` model sınırını bildirir; metni ezerek sahte uygunluk üretilmez. |
| `modules/legendstream-tv-remote/android/src/main/java/expo/modules/legendstreamtvremote/TvFocusPolicy.java` | Başlangıç üretim Java policy'si yeni regresyon geometrisinde Hero DOWN ile ilk kart yerine daha yukarıdaki uzak “Hepsini Gör”ü seçiyor. Eski dosya ile yeni senaryo JVM'de çalıştırılarak bu hata yeniden üretildi. | Mevcut native owner içinde Home Hero/raf kimliklerinden satır komşuluğu: Hero yatayda Hero; raf yatayda kendi kartları; dikeyde aynı rafın başka kartına sıçrama yok. Hero DOWN ilk raf kartına; hizalı kart UP başlık eylemine, başlık DOWN kendi rafına. | Mevcut57/57 policy, yeni Home88/88 ve stability21/21; farklı ölçekler, sınır, scroll sonrası ID/koordinat, stale target ve repeat guard. | JVM Android requestFocus/FocusFinder değildir. Raf başlığına erişim fiziksel kumandayla ayrıca onaylanmalı. |
| `.../LegendStreamTvRemoteModule.kt` | Native focus() scroll reveal'i `immediate=false` ile başlatıp hemen requestFocus yapıyordu; kaydırmanın tamamlanması aynı ana denk gelmeyebilir. | Yalnız native yön girdisinde requestRectangleOnScreen immediate=true; ardından mevcut requestFocus. Restore sahipliği, Back, motor ve orientation değişmez. | JVM yeni ölçülmüş koordinat/kimlik senaryosu; mevcut lifecycle/regresyon testleri. | Kotlin Android UI ve gerçek parent ScrollView reveal sonucu bu JVM testinde çalıştırılmaz. Donanım kabulü zorunlu. |
| `tests/nativeTvHomeLayoutScenarios.ts`, `nativeTvHomeRenderScenarios.mjs`, `nativeTv/TvHomeReachabilityScenarios.java`, `nativeTvFocusJvmScenarios.mjs`, `.github/workflows/quality.yml` | Eski testler büyük Hero, daha kısa raf başlığı ve raf kartını aynı gerçekçi geometride ayırmıyordu. | Geometri, gerçek bileşen render sözleşmesi ve üretim Java yön politikası ayrı testlere ayrıldı; Quality'ye eklendi. | Aşağıdaki test matrisi. | Host render adaptörü gerçek RN/Android layout renderer değildir; kaynakta prop aramakla sınırlı değildir ama fiziksel görsel kabul de değildir. |

## Eski / yeni geometri ve ilk raf görünürlüğü

Aşağıdakiler **dp model sonuçlarıdır**, Homatics ölçümü değildir. fontScale1, varsayılan overscan, sıfır safe-area; dış alt kenar10dp ve kaynak header/nav bütçesiyle örnek ScrollView yüksekliği hesaplanır. Üretimde onLayout değeri bu tahmini değiştirir. Eski değerler görselli Hero max520 ve bölüm kartları + ilk raf öncesindeki yaklaşık176dp bütçeyle karşılaştırılır.

| Pencere dp | Örnek ScrollView | Eski Hero | Yeni Hero | Eski ilk kart görünümü | Yeni ilk kart başlangıcı* | Yeni görünür kart alanı |
|---|---:|---:|---:|---:|---:|---:|
| 960×540 | 369 | 398 | 112 | 0 | 176 | 144 |
| 1280×720 | 539 | 520 | 160 | 0 | 224 | 260 |
| 1920×1080 | 862 | 520 | 263 | 98 | 327 | 467 |
| 1536×864 | 666 | 520 | 200 | 0 | 264 | 342 |

*Home kullanılabilir alanının başına göre; parent top22dp ve bottom güvenli bütçe ayrıca düşülür. “Görünür kart alanı” raf kartları için kalan dikey penceredir; karttan büyük değer kartın büyütüldüğü anlamına gelmez. Boş Hero'nun eski max420 sınırı farklıydı; yeni görsel/boş/loading ortak yüksekliği render testinde karşılaştırılır.

%33 sabit kabul kuralı değildir. Örneğin yüksek fontScale'de okunabilir başlık için Hero daha yüksek orana çıkabilir, metadata kapanabilir veya başlık tek satır ellipsis olabilir. Tam başlık accessibilityLabel'da kalır; tam metnin TV'de okunacağı mevcut detay deneyimi bu kesitte genişletilmez. Hero içinde ayrı yeni eylem düğmeleri yoktur: mevcut kartın OK/onOpen eylemi korunur.

## Odak ve scroll sözleşmesi

- Üst navigasyon DOWN → görünür Hero; Hero yok/yükleniyorsa ilk geçerli anlamlı hedef.
- Hero LEFT/RIGHT → diğer Hero kartı; DOWN → ilk rafın kartı; UP → üst navigasyon.
- Raf LEFT/RIGHT → aynı raftaki komşu kart; sınırda başka rafa çapraz atlama yok.
- Raf DOWN/UP → komşu rafın kartı. İlk rafın sol kartı UP → Hero. Başlıkla hizalı sağ kart UP → kendi “Hepsini Gör” eylemi; bu eylem DOWN → kendi rafı. Yükleniyor/boş raflarda kart yoksa geçerli başlık/boş durum eylemi korunur.
- Bölüm sayacı/kısayol kartları TV'de tüm rafların sonundadır ve DOWN ile hâlâ erişilir; telefon/tablet/TV Preview sırası değişmez.
- Mevcut `home-shelf:<raf>:<item>` ve `home-hero:<item>` kimlikleri korunur. Boş Hero `home-hero:empty` olur. Mevcut Home/Live/Movies/Series bölgeleri ve player/modal scope'ları aynı native owner'dadır. Yeni JS focus yöneticisi veya global interceptor eklenmez.
- Native yön isteği hedef dikdörtgenini reveal eder, sonra mevcut View'a focus ister. Mounted offscreen komşu sırf viewport dışında diye silinmez; unmounted/hidden/disabled/focusable=false hedefler mevcut native filtreden geçmez.
- Native TV Hero ve raf FlatList'lerinde removeClippedSubviews=false; bu sanallaştırmayı kapatmaz, clipping kaynaklı erken detachment riskini azaltır. Çok uzak unmounted komşu hâlâ seçilemez; gerçek uzun raflarda virtualization sınırı fiziksel test ister.
- Native border alanı sabit, scale yok; native outline yetkilidir. Son seçili/aktif içerik beyaz focus sanılmaz. Clip sınırları cihazda doğrulanmalıdır.
- Render/onLayout sadece ölçü/kayıt yapar. Restore ticket iptali ve valid-ID kontrolü korunur. Odak gezinmesi playback çağırmaz; OK mevcut gerçek focused target'ın onPress yoludur.
- Inspector salt gözlemci kalır; açık/kapalı aynı dispatcher ve policy kullanılır. Tuş, beklenen hedef, gerçek focus ve eylem ayrı kanıttır.

## Test kanıtı ve sınırlamalar

1. **Geometri68/68:** dört dp pencere × dört fontScale × iki safe-area × iki overscan=64; üç bozuk viewport ve ölçülen yükseklik değişimi=4. Caption line-height, border alanı, Hero sınırı, raf başlığı ve minimum kart preview bütçesi sınanır.
2. **Üretim Hero bileşeni render33/33:** gerçek `HomeHeroCarousel` React bileşeni; dört pencere × dört font × kısa/uzun Türkçe başlık=32; mobil dal=1. Her TV senaryosunda görselli/görselsiz/boş/loading markup ve yükseklik kıyaslanır. Host adaptörü RN View/Text/FlatList sunucuda render eder; gerçek glyph wrapping, görüntü decode veya Android ölçümü değildir.
3. **Native Home88/88:** gerçek production TvFocusPolicy/TvFocusStability; dört koordinat ölçeğinde22 kontrol. Scroll sonrası test güncellenmiş dikdörtgeni policy'ye verir, Android scroll motorunu çalıştırmaz. OK testi policy'nin seçtiği tag'in eylemini çalıştırır; fiziksel KeyEvent→React onPress teslimatı değildir.
4. Mevcut Java policy57/57, stability21/21; responsive240/240; Inspector41/41; TV Preview32/32; native exit6/6; adaptive navigation16/16; orientation lifecycle14/14; TypeScript ve Universal APK build sözleşmesi yerelde geçti. Provider/katalog/redaksiyon dahil mevcut tam Quality yeni exact SHA'da çalışır.

4K fiziksel çıkış pikseli1920/3840 olarak otomatik dp sayılmaz;1536×864 yalnız ölçekli pencere senaryosudur. Inspector testleri gerçek TV overlay yerleşimini veya firmware event davranışını kanıtlamaz. Gerçek Android/Kotlin derleme ve fiziksel playback sürekliliği bu tur otomatik testlerinden çıkarılamaz.

## APK hazırlığı ve Homatics fiziksel sıra

Yeni APK bu tur üretilmedi; workflow universal moduna hazır, ARM64+ARMv7/LibVLC/paket sözleşmesi korundu. Üretilecek APK yalnız PR #138'in raporlanan yeni final SHA'sından olmalı. APK #504 bu düzeltmenin kanıtı değildir. APK artifact veya dosya SHA256 henüz yoktur; kaynak commit SHA'sı ile karıştırılmaz.

1. Yeni Universal APK'nın kaynak SHA'sını doğrula; Homatics'te Native TV modunda aç. dp pencere, fontScale ve overscan ayarını kaydet.
2. Başlangıçta Hero, ilk raf başlığı ve kart görünümünü videoya al; kısa/uzun başlık ve görsel yok durumunu karşılaştır. Harfler/metadata üst üste binmemeli.
3. Üst menü DOWN→Hero DOWN→ilk raf; ilk sol kart UP→Hero UP→menü. Hero/raf yatay komşuluk ve sınırları tek tek dene.
4. Sağdaki karttan UP→Hepsini Gör, DOWN→aynı raf; ilk/ikinci raflar arasında UP/DOWN. Bölüm kısayollarına en alttan ulaş.
5. Uzun rafta sağa/sola, raflar arasında aşağı/yukarı kaydır; focus görünür ve OK ile açılan öğeyle aynı kalmalı. Veri yükleme/sayfalama sırasında hedefin değişmediğini gözle.
6. Tek basış, uzun basış ve bırakınca60 saniye bekleme: otomatik focus hareketi/hidden loop olmamalı. Inspector açık/kapalı iki tur yap; request-failed/boundary/viewport ve gerçek ID'leri kaydet.
7. Player aç→OK→seçenek paneli→Back panel→Back kontroller→Back katalog. Aynı geçerli focus dönmeli. Telefon orientation ve TV Preview dalını ayrıca dene.
8. Xtream, M3U ve Stalker ile tekrarla; cihazın desteklediği çıkış/fontScale koşullarında gerçek dp'yi ayrıca kaydet.

Kabul: Kompakt görünüm ve doğru DOWN/UP/RIGHT/LEFT/OK/Back aynı yeni APK üzerinde fiziksel olarak gösterilmeden Native TV Physical PASS verilmez. Mevcut Player/Back ve hidden focus belirsizlikleri açık kalır. Merge yapılmaz; PR Draft kalır.
