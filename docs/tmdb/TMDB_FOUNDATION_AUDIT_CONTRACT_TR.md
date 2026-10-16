# TMDB İçerik Zenginleştirme — Kaynak Denetimi ve İlk Sözleşme

## 1. Kaynak kapısı ve izolasyon

- XPlayer main: `810adc2f7e82da52d8dd6768fcd5cf1d3040e106`.
- PR #139: `aa94b587a3b303cd5d25b656b679ad79b89e15ef`, open/Draft/not merged.
- #139 base: `feature/r18-native-tv-premium-ux` (#138).
- #139 exact Quality: [38974249519](https://github.com/d3vilsgo/Legend-Stream/actions/runs/38974249519), success.
- Gen2 main: `b6026566c0a772c6b1b53f48a4f108a89396714d`.
- Yeni çalışma: `feature/r19-tmdb-enrichment-foundation`; doğrulanmış #139 HEAD'inden
  ayrı worktree ve ayrı Draft PR. Base #139 branch'i; bağımlı değişiklikler kopyalanmaz.
- #138/#139 HEAD, açıklama, base veya state değiştirilmez. Merge yok.

Aşağıdaki XPlayer bulguları #139 kaynak ağacından çıkarılmıştır. Yeni özellikler
main'de varmış gibi değerlendirilmez. Gen2 yalnız bu görevde açıkça istenen
referanstır; Kotlin kodu kopyalanmamıştır.

## 2. Gerçek kaynak envanteri

| Dosya / sembol                                                                          | Kanıt                                                                                 | Kullanıcı etkisi                                    | İlk kesitte karar                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `lib/xtreamCatalog.ts` / `XtreamVodItem`                                                | stream_id, stream_icon, plot, cast, director, genre, releaseDate/release_date, rating | Liste verisi temel metadata taşıyabilir             | Aynı model korunur                                            |
| Aynı dosya / `XtreamVodInfo.info`                                                       | tmdb_id, movie_image, backdrop_path, duration_secs/duration, plot/description         | Doğrulanabilir ID ipucu film detay yanıtında mevcut | Hint ayrı adapter ile alınır; API detayı doğrulamalıdır       |
| Aynı dosya / `XtreamSeriesItem`                                                         | series_id, cover, backdrop_path, plot, cast, director, genre, tarih/rating            | Dizi bilgisi var; açık tmdb_id alanı yok            | Keyfi alan TMDB ID kabul edilmez                              |
| Aynı dosya / `XtreamSeriesInfo`                                                         | gerçek seasons ve episodes; bölüm id/container_extension/direct_source                | Playback TMDB bölümlerinden türetilmemeli           | Değiştirilmez                                                 |
| `lib/iptv.ts` / `M3UMovieItem`                                                          | id, providerId, name, streamUrl, logoUrl, category                                    | Başlık/görsel var; ayrı TMDB/yıl alanı yok          | streamUrl metadata'ya taşınmaz                                |
| Aynı dosya / M3USeriesGroup, M3USeriesEpisode                                           | group id; gerçek seasons ve bölüm id/season/episode/streamUrl                         | TMDB sezonu kaynak bölümüne eşit değildir           | Kimlik ayrımı korunur                                         |
| `lib/stalkerVod.ts` / StalkerVodItem                                                    | portalId, cmd, posterUrl, description, year, genre, rating, director, actors          | TMDB ID alanı yok; cmd playback oturumuna bağlı     | cmd metadata katmanına girmez                                 |
| `lib/stalkerSeriesProduct.ts`                                                           | series id; gerçek seasonId/episodeId; ayrı replay identity                            | Görünen bölüm numarası playback kimliği değildir    | Yeni TMDB sezon sözleşmesi playback intent değildir           |
| `lib/catalogPersistence.ts`                                                             | Provider-scoped persisted VOD/Series DTO; temel plot/cast/director; series backdrop   | TMDB ID kalıcı DTO'da yok; yeni tablo gerekir       | Bu PR mevcut DTO veya migration değiştirmez                   |
| `lib/catalogCache.ts`                                                                   | SQLite PK (provider_id, kind, item_id), ayrı kategoriler, payload                     | Sağlayıcı ve kind izolasyonu mevcut                 | Metadata ayrı depoda tutulmalı                                |
| `lib/catalogRuntime.ts` / resolveCatalogPlaybackSource                                  | Xtream canonical/direct ve M3U runtime ref çözümü                                     | TMDB ID ile URL üretmek bu sözleşmeyi bozar         | Resolver import/call edilmez, gelecekte aynı yol kullanılacak |
| `components/OptimizedHomeScreenPaged.tsx` / openMovie                                   | Doğrudan mevcut resolver → player; stream_id kimliği                                  | Burada kapsamlı film info page yok                  | Sonraki Film Info PR'ı                                        |
| `components/catalog/PagedCatalogViews.tsx`, `lib/goldenSeriesDetail.ts`                 | Başlık → sağlayıcı sezon/bölüm hiyerarşisi                                            | Zengin sinematik metadata sayfası değil             | Sonraki Series Info PR'ı                                      |
| `components/stalker/StalkerGoldenMoviesCatalog.tsx`, `hooks/useStalkerMoviesCatalog.ts` | Ayrı Stalker film oynatma callback'i                                                  | Xtream resolver ile birleştirilemez                 | Stalker akışı korunur                                         |
| `components/home/HomeDiscovery.tsx`                                                     | Mevcut yerel heroItems; TMDB orkestrasyonu yok                                        | Hero'ya dış katalog otomatik sokulmamalı            | Bu PR Home'u değiştirmez                                      |

## 3. Gen2 karşılaştırması

Referans dizin:
`app/src/main/java/com/legendstream/xplayer/gen2/data/tmdb/`.
Aynı isimli `app/applet/...` kopyaları kaynak seçilmedi.

- `TmdbMatcher.kt`: codec/dil/sürüm temizliği, yıl, yerel/orijinal ad ve
  Levenshtein >=.85 kabulü. Bilinen iki farklı yıl sert reddediliyor.
- `TmdbRepository.kt`: tr-TR arama, en-US ikinci arama; client-side yıl kontrolü;
  movie/series ayrı; Room cache 7 gün. En güçlü adayı maxBy ile seçiyor;
  eşdeğer farklı ID'ler için ayrı ambiguity reddi görünmüyor.
  Cache hit confidence=1 ve taze sonuç .95 atanıyor; bu istatistiksel kanıt değildir.
- `TmdbApi.kt`: movie/tv arama, detay, credits, similar ve haftalık trending.
- `TmdbClient.kt`: Retrofit/OkHttp, Authorization Bearer BuildConfig token,
  image URL helper. BuildConfig token APK içinde gizli kabul edilemez.
- `HomeEnrichmentManager.kt`: en fazla12 içerik, semaphore2, yerel artwork
  fallback, provider itemId'nin saklanması. Bu sınırlar faydalı referanstır.

XPlayer kararı: minimum yanlış pozitif. Fuzzy otomatik kabul eklenmedi;
aynı ad/yıl ile iki farklı TMDB ID varsa seçim yapılmaz. Yıl bilinmiyorsa,
doğrulanmış sağlayıcı ID'si olmadan isim benzerliği yetmez. Cache confidence
artırılmaz. Policy skoru olasılık veya fiziksel doğrulama olarak yorumlanmaz.

## 4. İlk PR'ın veri ve eşleştirme sözleşmesi

`lib/tmdb/contract.ts`: film/dizi türü, provider catalog identity, ayrı
provider episode identity, TMDB identity, tüm hedef metadata alanları ve binding.
Metadata: başlık/orijinal başlık, poster/backdrop path, özet, yıl, tür, dakika,
puan, oyuncu, yönetmen, sezon özetleri ve similar identity listesi. Eksik alan
undefined/boş dizidir. Metadata'da stream URL, token, cmd veya isPlayable yoktur.

`matcher.ts`:

1. Sağlayıcı ID'si yalnız pozitif safe integer hint'tir. Aynı tür/id ile detail
   kanıtı, yerel/orijinal ad uyumu ve bilinen yılın çelişmemesi gerekir.
   Hint yanlışsa başka ID'ye sessiz fallback yoktur.
2. Hint yoksa normalize ad veya orijinal ad birebir ve yıl bilinen/eşit olmalıdır.
3. Farklı tür/yıl, belirsizlik, boş veya aşırı uzun giriş reddedilir.
4. Teknik ekler suffix/bracket bölgesinde temizlenir; sayı ve devam filmi
   kimliği korunur. `1917`, `1984`, `Blade Runner 2049`, `Up`, `It` bozulmaz.
5. Yıl başlıktan yalnız parantez/köşeli parantezle çıkarılır. Bare yıl
   çıkarılmaması bilinçli false-negative tercihidir. Keyfi `TR`/dil ön ekleri
   ve her provider'ın özel adlandırması kusursuz çözüldü iddiası yoktur.
6. 100'den fazla aday sessiz kırpılıp birinci seçilmez; belirsiz reddedilir.

`providerInput.ts`: mevcut modellerden dar projeksiyon; stream/series/group/
portal kimliği aynen korunur. Xtream VOD detail TMDB hint'i yalnız movie_data
stream_id istenen stream ile eşitse alınır. Kimlik eksikse hint kullanılmaz.
Bu fonksiyonlar ekranlara henüz bağlanmaz.

`bindMetadata` / `bindingBelongsTo`: provider ailesi + providerId + kind +
catalogId + revision eşitliği. Bu yalnız metadata bağıdır, oynatılabilirlik
kanıtı değildir. Bölüm oynatmak için gerçek provider seasonId/episodeId,
güncel oturum ve mevcut resolver/create_link ayrıca gerekir.

## 5. Sağlayıcı uyumluluk matrisi

| Kaynak  | Film kimliği          | Dizi/bölüm kimliği                            | TMDB hint                       | Oynatma otoritesi                        |
| ------- | --------------------- | --------------------------------------------- | ------------------------------- | ---------------------------------------- |
| Xtream  | stream_id             | series_id + gerçek episode.id                 | Film info.tmdb_id, doğrulanarak | Mevcut credential/runtime resolver       |
| M3U     | providerId + movie.id | group.id + gerçek M3U bölüm id/season/episode | Modelde yok                     | Mevcut playable URL/runtime ref          |
| Stalker | providerId + portalId | seriesId + seasonId + episodeId               | Modelde yok                     | Session + create_link; cmd dışarı çıkmaz |

Bu PR hiçbiri için yeni Watch düğmesi, availability index veya bölüm eşlemesi
sunmaz. TMDB similar listesi keşif verisidir; sağlayıcı overlap'i sonraki
Mapping PR'ında provider-scoped DB sorgusuyla doğrulanır. Diğer hesapta bulunan
bir içerik aktif hesapta var sayılmaz. Hesap değişimi eski işi UI'ya commit edemez.

## 6. Cache / performans tasarımı ve uygulanan bölüm

Uygulandı:

- `TmdbCacheStore` async storage arayüzü ve en fazla256 girişli memory LRU.
- Başarılı eşleşme ve metadata için başlangıç TTL7 gün; negatif sonuç6 saat.
- Match key: algoritma sürümü, provider ailesi/ID, kind, catalogId, revision,
  normalize başlık/orijinal ad, açık veya çıkarılan yıl ve ID hint.
- Metadata key: kind + TMDB ID + locale; provider payload'ından ayrı.
- Süresi dolmuş, gelecekte yazılmış veya saat geri alınmış cache fresh sayılmaz.
- Cache hatası IPTV'yi engellemez. Network hatası negatif eşleşme olarak saklanmaz.
- Gate: concurrency2, bekleyen24; aynı key single-flight, taşan iş busy.
- Enjekte edilen adapter 429'u TmdbRateLimit ile bildirir: Retry-After süresine
  uyulur; yoksa 1/2/4…60sn backoff. Bekleyen iş cooldown'da ağa çıkmaz.
  Otomatik retry döngüsü/timer yoktur; UI daha sonra yeniden isteyebilir.
- Normalize query adapter'a providerId, playback URL veya credential taşımadan gider.
- Türkçe alanlar korunur, yalnız aynı kind/id English metadata'dan alan bazlı
  fallback yapılır; title/overview dil kaynağı ayrıca tutulur.

Henüz yok:

- HTTP/proxy adapter, gerçek API çağrısı, token ayarı, processler arası kalıcı cache.
- Metadata fetch/cache orkestrasyonu: storage sözleşmesi var; mevcut foundation
  yalnız eşleştirme işini cache'li ve bounded çalıştırır.
- SQLite migration veya production store bağlantısı. UI/provider/player değişmez.

Kalıcı plan: ayrı `tmdb_metadata.sqlite` dosyası. `metadata(kind,tmdb_id,locale,
payload,written_at,expires_at)` ve `matches(provider_id,provider_family,kind,
catalog_id,revision,fingerprint,matcher_version,result,written_at,expires_at)`.
Compound PK/unique index, süreli eviction ve toplam boyut kotası. URL/credential
saklanmaz. Provider silinince yalnız onun eşleşmeleri temizlenir; ortak TMDB
metadata başka hesaba availability sağlamaz. Mevcut catalog DB writer'ına ağır
TMDB payload veya toplu tarama eklenmez. Bu şema tasarımdır; migration yapılmadı.

Ekran önce yerel IPTV verisini göstermeli. Sonraki UI entegrasyonu görünür
12–20 kartla sınırlı olmalı; Home binlerce istek başlatmamalı. Provider/katalog
revision değişince gecikmiş sonuç UI'ya uygulanmadan kimlik yeniden kontrol edilir.

## 7. Güvenlik ve resmî TMDB koşulları

Kaynaklar (17 Ekim2026 kontrolü):

- https://developer.themoviedb.org/docs/faq
- https://developer.themoviedb.org/docs/languages
- https://developer.themoviedb.org/docs/rate-limiting
- https://developer.themoviedb.org/docs/authentication-application

TMDB token üretim APK'sında gizli değildir. Tercih: erişim kontrollü backend
proxy; server secret, sabit TMDB endpoint allowlist, client quota, response
projeksiyonu. Açık/anonim genel URL proxy kurulmaz. İlk PR token eklemez.
Kullanıcı anahtarı seçeneği değerlendirilirse secure storage cihazda saklamayı
korur; APK veya runtime extraction'a karşı mutlak gizlilik sağlamaz.

Loglar query token, Authorization, IPTV URL/username/password/MAC/cmd içermez.
Yeni kod log üretmez ve ham adapter hatasını dışarı vermez; sabit durum döndürür.
TMDB görselleri sabit image.tmdb.org CDN'i ve doğrulanmış path ile üretilir.

Resmî FAQ, veri/görsel kullanımında atıf ve onaylı logo ister; About/Credits'te
“This product uses the TMDB API but is not endorsed or certified by TMDB.”
bildirimi görünür olmalıdır. Ticari kullanım için uygun TMDB anlaşması değerlendirilir.
Logo LegendStream'den baskın olamaz. Bu PR TMDB verisini UI'da sunmadığından
attribution ekranını değiştirmez; ilk gerçek metadata UI tesliminin kabul şartıdır.
Resmî rate limit üst sınırı sabit garanti değildir; 429'a uyum esastır.

## 8. Yanlış eşleştirme riskleri ve regresyon sınırı

- Aynı ad/yıl, remake, kısa adlar: ambiguity reddi; uygun provider ID yoksa
  manuel onay veya unresolved durum. Tam otomatik yüzde100 doğruluk iddiası yok.
- Türkçe/orijinal çeviri farklılığı: eşit orijinal ad destekli; API alias araması
  sonraki transportta aday üretir, kabul eşiğini düşürmez.
- Yanlış provider yılı veya ID: reject; düzeltme için veri incelemesi gerekir.
- Katalog ID yeniden kullanımı: revision ve fingerprint; gerçek playback'te
  yeniden provider sorgusu gerekir.
- TMDB bölüm bilgisi: açıklama olabilir, oynatılabilir bölüm diye gösterilmez.
- API yokluğu/429/cache hatası: yerel katalog ve mevcut playback değişmez.
- TV Back/focus/orientation P0: bu PR çözmez; fiziksel FAIL devam eder.

## 9. Test kanıtı ve küçük PR sırası

Yeni `tests/tmdbFoundationScenarios.ts`: normalize/Unicode/numeric sequel,
yıl/tür/ID/ambiguity redleri, altı provider projection, binding izolasyonu,
TTL sınırı/clock rollback/LRU, inferred year fingerprint, dil fallback,
CDN güvenliği, concurrency/queue/single-flight,429/backoff, cache/network hata
izolasyonu. Deterministik sahte adapter ve saat kullanılır; canlı TMDB testi değildir.
Mevcut catalog persistence/parity/redaksiyon testleri ayrıca çalıştırılır.
Tam Quality yeni exact commit üzerinde doğrulanır; sonuç PR/final raporda yazılır.

| Küçük teslim          | Kapsam ve kabul                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| 1 — bu PR             | Kaynak denetimi, sözleşme, strict matcher, memory cache/gate, kimlik koruması, test                 |
| 2 — Film Info         | Güvenli API/proxy kararı + detail adapter/kalıcı store; yerel veri önce; attribution; film detay UI |
| 3 — Series Info       | Türkçe detay + gerçek provider sezon/bölüm listesinin ayrı sunumu; resume kimliği korunur           |
| 4 — IPTV Mapping      | Aktif provider DB overlap/availability; existing resolver/create_link; stale identity reddi         |
| 5 — Elite Home Hero   | Yalnız gerçek IPTV içeriği; bounded enrichment; İzle/Devam/Detaylar mevcut kimliklerle              |
| 6 — Performans/görsel | Cache boyutu, API429, düşük güçlü cihazlar, uzun metin, TV/mobil fiziksel test                      |

Mevcut Player, Back, Focus, orientation ve Elite Live TV kodlarına ilk PR'da
dokunulmaz. #138/#139 ayrı Draft kalır; merge yapılmaz.
