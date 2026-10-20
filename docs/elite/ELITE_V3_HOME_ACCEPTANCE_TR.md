# Elite V3 Home — 20 Ekim 2026

Başlangıç: `d66ce5de0c49566d3d2cf9260fb95782d8acbfef`. PR #143 OPEN/DRAFT, branch `integration/legendstream-u1`, base `feature/r19-tmdb-secure-proxy`. Başlangıç Quality #1539 / 39412257872 SUCCESS aynı SHA üzerinde doğrulandı. Bu kayıt Home dilimidir; diğer ekranların V3 kabulü değildir.

## Üretim uygulaması

- `HomeDiscovery.tsx`: V3 palette/font/Focus tokenları; telefon başlığı 34 → 24 dp; gereksiz LEGEND ELITE tekrarının kaldırılması. Native genişlik/yükseklik yeterliyse başlığın altında aksiyonlar; kısa dp ve büyük fontScale için mevcut yatay düzen. TV açıklaması kaldırılarak başlık/metadata/aksiyon bütçesi korunur.
- `nativeTvHomeLayout.ts`: mevcut yükseklik, safe-area, ilk raf bütçesi korunur; tipografi/padding ortak tokenlara bağlıdır.
- `eliteV3Tokens.ts`: Home gradient, overlay, poster ve 16:9 devam kartı ölçüleri. Devam rafı dikey poster yerine landscape gösterilir; gerçek progress ve `onOpenMedia` nesnesi korunur.
- İzle/Detay gerçek provider callback'lerine bağlı; dizi mevcut bölüm seçimine gider. Home API'sinde gerçek favori/list aksiyonu bulunmadığı için süs düğmesi eklenmedi.
- Mevcut `ResponsiveContentNav`, Native Window Focus/Preview sahipleri, Player, provider/session/SQLite/resolver yolları değiştirilmedi. Hero/shelf kimlikleri ve fold/restore callback'leri korundu.

## Ölçülen üretim host matrisi

Ölçü birimi dp; `viewportHeight=height-140`, safe-area 8/12/16/24, fontScale=1. Yükseklikler üretim Hero render ağacından okunur; fiziksel Android ölçümü değildir.

| Profil             | Hero minHeight | Başlık | Aksiyon düzeni | Devam kartı genişliği |
| ------------------ | -------------: | -----: | -------------- | --------------------: |
| TV logical 960×540 |            116 |     24 | Yan yana       |                   224 |
| TV 1280×720        |            174 |     26 | Başlık altında |                   224 |
| TV 1920×1080       |            288 |     30 | Başlık altında |                   224 |
| Tablet 1280×800    |            190 |     27 | Yan yana       |                   212 |
| Telefon 393×873    |            310 |     24 | Başlık altında |                   184 |
| Telefon 873×393    |            160 |     24 | Yan yana       |                   184 |
| Preview 873×393    |            160 |     30 | Yan yana       |                   224 |

Her profil fontScale 1/1.3/2 ile gerçek Home → Hero → Shelf → kart callback/render ağacında sınanır. Native 68 geometri senaryosunda ilk karttan en az 72 dp görünür kalır. İki rafın tam görünmesi her viewport/fontScale için garanti değildir; kısa ekranlarda scroll gerekir. Stacked TV aksiyonlarının title/metadata/button bütçesine sığdığı ayrıca kesin assertion ile doğrulanır.

## Otomatik kanıt

- V3 gerçek Home render/callback matrisi: **21/21 PASS** (yeni).
- U4.2 Hero/raf Focus fold/restore/provider sınırı: **12/12 PASS** (korundu).
- Home React render: Native **33/33**, responsive **32/32 PASS**.
- Native Hero geometri: **68/68 PASS**.
- Home/Player retry/error/Back üretim host: **18/18 PASS**.
- StageRail/Live üretim host: **6/6 PASS**; Focus sahipliği **9/9 PASS**.
- U4.3 Series **40/40 PASS**; mobil Live **4/4**, Movies **10/10**, Series **10/10** profil.
- Native responsive TS ve JVM: **240/240** ayrı matrisler; Native focus policy/stability/reachability mevcut testleri PASS.
- `pnpm run typecheck`, değişen Home kaynakları için `pnpm exec prettier --check`: PASS.
- Yerelde `pnpm exec tsx` IPC soketi EPERM verdi; aynı TS senaryoları `node --import tsx` ile çalıştırıldı. CI mevcut tsx komutunu korur.
- Yeni assertion mevcut Quality Home host adımında çalışır; Home production formatting ayrıca workflow'a eklendi. Final exact-SHA Quality sonucu commit sonrası doğrulanır; başlangıç sonucu yeni SHA için kullanılmaz.

## Render kanıtı ve sınırlar

`scripts/build-home-review.mjs` başlangıç SHA ve çalışan Home kaynaklarını aynı açık fixture verisiyle React Native Web'e bundle eder; phone/landscape/tablet/Preview/960/720/1080 profillerini sunar. `node scripts/build-home-review.mjs <output-dir>` ile yeniden üretilebilir. Örnek veriler yalnız review scriptindedir; üretim Home'a eklenmez. Gerçek medya servisi ve fiziksel input bağlanmaz.

Üretilen önce/sonra HTML kaynak render incelemesidir. Ortamda Chromium executable bulunmadığından browser screenshot/piksel taşma doğrulaması yapılamadı. Onaylı Home görselinin metinsel içeriğine erişildi; piksel eşleşmesi henüz onaylanmadı. Erişilmiş veya fiziksel render gibi sunulmaz.

**SOURCE/HOST PASS; VISUAL/PHYSICAL PENDING.** Homatics RIGHT, OK ve hızlı D-pad tarihsel FAIL açık kalır. Native TV Physical FAIL, TMDB LIVE BLOCKED, legacy 14 SKIP / 0 DELETED kayıtları değişmez. Homatics üzerinde raf/hero/rail Focus ve Back; Poco/tablet üzerinde büyük yazı, güvenli alan ve metin kırpılması yeniden kabul bekler. U4.4, yeni ekran, APK, merge/base/Draft değişikliği yok.
