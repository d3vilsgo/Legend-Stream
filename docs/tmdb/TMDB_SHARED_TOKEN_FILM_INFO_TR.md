# TMDB Ortak Token Kararı ve Film Info Kesiti

## Doğrulanmış taban

- main: `810adc2f7e82da52d8dd6768fcd5cf1d3040e106`.
- #138: `3755a39b48441fd0904d3a40a7a8c77576ee0281`, Draft.
- #139: `aa94b587a3b303cd5d25b656b679ad79b89e15ef`, Draft.
- #140: `b396fbfcccc0e8205dcaec43de088d0dcba5c7d7`, Draft.
- Yeni bağımlı çalışma: `feature/r19-tmdb-film-info`, base #140 branch'i.
  #138/#139/#140 kaynaklarına, başlıklarına, base veya state'lerine müdahale edilmez.

## Kesin erişim kararı

Gen2 ve XPlayer aynı mevcut TMDB API Read Access Token'ı kullanacaktır.
Yeni token istenmez. Bu görev token değerini Gen2 dosyalarından, ortamdan,
APK'dan veya secret store'dan okumaz. Token değeri kaynak, .env, build parametresi,
uygulama extra/config veya APK'ya kopyalanmaz. Gen2 uygulaması değiştirilmez.

Aynı token kullanılması, iki deponun secret'larına otomatik erişim olduğu
anlamına gelmez. Bu görevde erişim kontrollü, doğrulanmış bir TMDB proxy
endpoint'i ve ona ait uygulama oturumu sağlanmış değildir. Dolayısıyla:

**LIVE_TMDB_NOT_CONFIGURED — canlı TMDB bağlantısı yapılmadı.**

`accessPolicy.ts` ortak token'ın server'da tutulacağını ve mobile/direct
TMDB erişiminin kapalı olduğunu belirtir. Origin doğrulaması yalnız yapılandırma
kontrolüdür; kimlik doğrulama, çalışan backend veya güvenlik onayı değildir.
HTTPS origin + uygulama oturumu olsa bile sonuç `adapter-required` kalır.
Production varsayılan `MovieInfoService` transport olmadan çalışır ve ağ
isteği başlatmaz. Test fixture'ları üretim bileşenine veya kataloğa eklenmez.

## Gerçek backend denetimi

| Kaynak                            | Gerçek bulgu                                        | Sonuç                                                     |
| --------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| `artifacts/api-server/src/app.ts` | CORS allowlist, request body limit, pino serializer | CORS mobil istemci kimliği değildir                       |
| `src/routes/index.ts`             | health ve IPTV router mount edilmiş                 | TMDB route yok                                            |
| `src/middlewares`                 | Xtream rate limiter mevcut                          | Genel kullanıcı/uygulama session doğrulaması yok          |
| `src/routes/iptv.ts`              | Sağlayıcı user_info auth kontrolü                   | TMDB proxy için uygulama oturumu yerine kullanılamaz      |
| `src/lib/logger.ts`               | Header/body redaksiyonları mevcut                   | Yeni proxy ham TMDB/network error veya secret loglamamalı |

Bu nedenle açık bir token'lı proxy route'u eklenmedi, sunucu deploy edilmedi.
Güvenli bir endpoint var/yok konusunda dış deployment envanteri varsayılmadı;
burada yalnız incelenen kaynak ve bu oturumda sağlanan erişim değerlendirildi.

## Kontrollü proxy planı — henüz uygulanmadı

1. Mevcut aynı token güvenli operasyon kanalından server secret store'a bağlanır;
   uygulamalar token değerini almaz. Örnek secret adı yalnız server tarafında
   `TMDB_READ_ACCESS_TOKEN`; .env örneğine bile token değeri yazılmaz.
2. Uygulamaya ait doğrulanmış kullanıcı/cihaz oturumu zorunlu. APK içine sabit
   proxy API key gömmek veya yalnız CORS'a güvenmek yeterli değildir.
3. Sunucu yalnız movie search/detail/credits/similar işlemlerini sabit TMDB
   host/path allowlist'iyle yapar; istemci keyfi URL/host/header gönderemez.
4. İstek gövdesi normalize başlık/yıl/medya türü veya TMDB ID/locale ile sınırlı;
   IPTV hesap bilgisi, stream URL, cmd veya MAC gönderilmez.
5. Per-session quota, concurrency, 429/Retry-After, timeout ve güvenli hata
   kodları zorunlu. Server metadata cache paylaşılabilir; provider availability
   hiçbir zaman TMDB sunucu yanıtından türetilmez.
6. Güvenli adapter hazır olduğunda `MovieInfoService` composition üzerinden
   enjekte edilir. Origin kontrolü tek başına transport'u etkinleştirmez.

## Gerçek Film Info entegrasyonu

- `PagedCatalogViews.tsx` / PagedMoviesCatalog: Xtream ve M3U film kartı artık
  Film Info açar. Sayfalı M3U DTO'su Xtream şekline benzer olsa da metadata
  identity provider='m3u' kalır; doğrudan URL projection'a girmez.
- `StalkerGoldenMoviesCatalog.tsx`: gerçek Stalker film kartı aynı modalı açar.
  İzle, mevcut `catalog.openMovie` oturum/create_link yoluna gider.
- Home Hero ve Series davranışları değiştirilmedi. Home'dan mevcut doğrudan
  oynatma kısayolları bu kesitte Film Info'ya çevrilmedi.
- Film bilgisi provider adı/görsel/özet/tür/oyuncu/yönetmen/puan ile hemen görünür.
  Eksik alan uydurulmaz. Sağlayıcı puanı TMDB puanı diye etiketlenmez.
- Güvenli transport verilmediğinde yalnız yerel veri gösterilir. Kullanıcıya
  “IPTV bilgileri gösteriliyor. Ek film bilgisi şu anda kullanılamıyor.” denir;
  altyapı/token ayrıntısı ürün akışına taşınmaz.
- Tam ekran responsive modal, scroll, poster/backdrop ve sade İzle/Geri eylemleri.
  Görseller yoksa sayfa çalışır. Native TV metni selectable/focus target değildir.
- İzle yalnız mevcut film kartından açılan bu ekranda vardır; güncel provider
  listesinde aynı gerçek kimlik bulunmadan callback çağrılmaz. Silinmiş film
  kapatılır. TMDB benzer ID'leri Watch düğmelerine dönüştürülmez.
- Kaynak movie DTO'su veya stream URL metadata ile değiştirilmez. Existing
  playback callback/resolver ve Stalker oturum korumaları otorite kalır.

## Servis ve metadata doğrulaması

`MovieInfoService`: #140 matcher, request gate ve memory cache'i yeniden
kullanır. Kabul edilmiş eşleşmeden sonra aynı TMDB movie ID için tr-TR detay
istenir. Başlık/özet eksikse en-US alan fallback'i denenir. İngilizce çağrı
başarısızsa Türkçe/yerel veri korunur. Yanlış ID/tür/locale/yıl ve bozuk temel
metadata alanları kabul edilmez. 7 günlük metadata cache çalışır; kalıcı
SQLite migration veya gerçek HTTP adapter bu PR'da yoktur.

`beginMovieEnrichment`: modal kapanınca veya provider/item/revision değişince
eski async sonucu UI'ya uygulamaz. Modal ayrıca sonuç fingerprint'ini kontrol
eder; yanlış filmin metadata'sı geçici olarak bile yeni filmde kullanılmaz.
İptal pending işi fiziksel ağdan abort ediyor iddiası yoktur; adapter henüz yok,
sonuç commit'i engellenir. Sınırlı gate ağ işlerini yönetir.

## Back, Focus ve oynatma sınırı

Modal Android `onRequestClose`, TV Preview back callback'i ve mevcut
`pushFocusScope('movie-info')` sözleşmesini kullanır. Açık modalın scope'u ayrıdır;
Geri kapatır, native scope pop önceki geçerli hedefe dönüşü yönetir. Yeni
fiziksel key interceptor, ayrı BackHandler veya programatik focus timer yoktur.

İzle modalı kapatır ve mevcut provider callback'ini çağırır. Player açılmazsa
hata mevcut katalog mekanizmasında kalır; bu kesit player yaşam döngüsünü
veya orientation politikasını yeniden yazmaz. Player Back/focus P0 sorunları
çözülmüş sayılmaz. Yeni modalın gerçek Android focus/restore kabulü bekler.

## TMDB atfı ve canlı bağlantı öncesi kapı

Enriched görünümde API bildirim metni ve TMDB bağlantısı vardır. Canlı UI
etkinleştirilmeden önce onaylı TMDB logosu/About-Credits yerleşimi ve uygun
kullanım şartları tamamlanmalıdır. Bu teslimde gerçek TMDB verisi UI'ya
getirilmedi; logo/atıf tamamlandı veya ticari onay alındı iddiası yoktur.
Resmî referanslar: https://developer.themoviedb.org/docs/faq ve
https://developer.themoviedb.org/docs/authentication-application .

## Test ve kabul

- 34 mock Film Info senaryosu: token-free policy/config, yerel veri,
  doğru TMDB kimliği, Türkçe/English fallback, yanlış ID/tür/locale/yıl,
  malformed cast/puan, cache TTL, single-flight, 429/hata gizliliği,
  modal kapanma/provider değişimi sonrası geç sonuç reddi, güncel kayıtla oynatma.
- #140 57 foundation; mevcut paging25, Stalker boundary23, Preview32,
  remote25 ve exit6 senaryoları yerelde geçti. TypeScript ve Prettier kontrolü.
- Bu testler mounted React Native renderer veya gerçek kumanda testleri değildir.
  Modalın D-pad/OK/Back/scroll davranışı fiziksel cihazda henüz doğrulanmadı.
- Exact-SHA tam Quality sonucu PR açıklaması ve final raporda belirtilir.
- APK veya backend deployment yapılmaz. Canlı TMDB kabulü verilmez.

Fiziksel tur: Xtream, M3U, Stalker için ayrı film kartı → Info → Geri → aynı
liste; yeniden Info → İzle → mevcut Player. Eksik poster/özet, uzun metin,
960×540 / 1280×720 / 1920×1080 dp ve büyük fontScale, hızlı film/provider
geçişi denenmeli. TMDB tarafı ancak güvenli adapter devreye alınırsa ayrı
canlı turda doğrulanabilir. Native TV Physical FAIL önceki P0'lar nedeniyle sürer.
