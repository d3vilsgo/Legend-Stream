# PR #142 — güvenli bağlantı ikinci denetim raporu

## Kaynak kapısı

| PR | Başlangıç HEAD | Base |
|---|---|---|
| #140 | `b396fbfcccc0e8205dcaec43de088d0dcba5c7d7` | `feature/r18-legend-elite-design-v1` |
| #141 | `70ca5c533e9abdbee4388225c7b140ce9af81e20` | `feature/r19-tmdb-enrichment-foundation` |
| #142 | `cccccfa8bcc07d979b7cacf739973c720693a27d` | `feature/r19-tmdb-film-info` |

Gen2 main `b6026566c0a772c6b1b53f48a4f108a89396714d`: `TmdbClient.kt` yeniden incelendi. `BuildConfig.TMDB_API_TOKEN` okuyup doğrudan TMDB Authorization header'ı oluşturuyor. Token değeri okunmadı, aranmadı veya kopyalanmadı. Gen2 değiştirilmedi. Bu sebeple iki uygulamanın merkezi proxy kullanımına geçişi tamamlandı denemez.

Bu tur yalnız #142 branch'inde TMDB HTTP/security/test/doküman değişiklikleri yapar. #138 odak düzeltmeleri bu commit'e taşınmadı. Diğer PR'lar korunur. Yeni SHA ve exact-SHA Quality run bağlantısı PR sonuç bölümünde verilir.

## Gerçek durum ve çalıştırma modeli

**TMDB LIVE BLOCKED — gerçek bağlantı kurulmadı/test edilmedi.** Onaylı dağıtım hedefi ve güvenilir session issuer yoktur; mevcut token'ın server secret kaydına bağlandığı doğrulanmamıştır. Bunlar üretim kabul engelidir. Film Info üretim varsayılanı IPTV metadata'sını gösterir. Mock içerik üretim ekranına yerleştirilmedi.

Mevcut `artifacts/api-server/src/index.ts` PORT üzerinden Express `app.listen` başlatan **kalıcı Node HTTP sürecidir**. `build.mjs` Node için bundle üretir; package scripts `build`/`start` sağlar. TMDB request, cache, limiter ve cooldown bu süreç belleğindedir. DB bağımlılıkları bulunan genel API'den yararlanır; TMDB için yeni DB zorunlu değildir. Restart cache ve limit durumunu kaybettirir.

Bu haliyle güvenlik kotalarını koruyan çok-instance/serverless dağıtım hazır değildir. Express için serverless adaptör yazılabilir, fakat cold start/replica başına quota/cache dağılımı shared storage olmadan kabul edilmez. Tek kontrollü process ilk işletim sınırıdır. HTTPS ingress, process supervision ve server-only secret injection gerekir. **Netlify veya başka hosting seçilmedi/dağıtılmadı.** Yetkili depolarda doğrulanmış bir hedef konfigürasyonu bulunmadı; hesap/credential envanteri veya gizli değerler araştırılmadı.

## Yapılan değişiklikler

| Dosya | Kanıt / eksik | Düzeltme ve doğrulama |
|---|---|---|
| `artifacts/api-server/src/app.ts`, `routes/index.ts`, `routes/tmdb.ts` | Genel JSON parser'dan sonra mount edilen route, parser hatalarının güvenli proxy hata sözleşmesine girmesini garanti etmiyordu; HTTP yöntem/body/auth sırası test edilmemişti. | TMDB route CORS'tan sonra, genel parser'dan önce mount edilir. Yalnız POST; auth önce; application/json ve 2 KB sınır; invalid JSON400, büyük body413, yanlış type415; sabit güvenli JSON. Route factory ile gerçek Express/loopback HTTP testleri. |
| `artifacts/api-server/src/lib/tmdb/proxy.ts` | Timeout iptal davranışının çalıştırılan testi yoktu; HTTP-date Retry-After varsayılan60'a düşüyordu. Toplu oturum iptali yalnız key rotation ile mümkündü. | Varsayılan8 sn timeout için injected kısa test süresi; AbortSignal doğrulaması; saniye veya HTTP-date Retry-After, en çok1 saat; `minimumIssuedAt` admin geçersizleştirme eşiği. 429 cooldown sonrası retry ve TTL davranış testleri. |
| `artifacts/legendstream-xplayer/lib/tmdbProxy/transport.ts` | Uygulama oturumu/account ömrü sona erdiğinde devam eden HTTP'yi durdurma adaptörü yoktu. | Opsiyonel lifetime AbortSignal; pre-abort ağ başlatmaz, in-flight abort çalışır, listener/timer temizlenir. Varsayılan10 sn timeout korunur. Playback veya provider kimliği değişmez. |
| `artifacts/api-server/src/lib/tmdb/proxyHttp.test.ts` | HTTP middleware sırası ve status/body sınırları sadece pure servis testleriyle kanıtlanamaz. | Gerçek loopback TCP/HTTP + mocked TMDB upstream 15/15. Canlı HTTPS/TMDB testi değildir. |
| `tests/tmdbSecureProxyScenarios.ts`, `.github/workflows/quality.yml` | Client timeout/lifetime cancellation ve HTTP sınırı CI kapsamında eksikti. | Proxy32/32 + HTTP15/15 Quality'ye dahil. Film Info34/34 ve foundation57/57 aynen korunur. |

## Yetkilendirme ve oturum yaşam döngüsü

- Session'ı bu proxy üretmez. Güvenilir login/cihaz kayıt servisi gerçek hesap/cihaz yetkisini **sunucuda doğrulayarak** session üretmelidir. Android ID veya istemcinin app adına güvenilmez; imzalı `app` claim'i issuer yetkisindedir.
- Proxy yalnız HS256, tam issuer, `aud=legendstream-tmdb`, `app=xplayer|gen2`, anonim subject, iat/exp ve varsa nbf kontrol eder; en fazla300 sn ömür. Hatalı oturum401; eksik/yanlış server config503.
- `app:sub` rate principal'dır: iki uygulamanın aynı upstream TMDB secret'ını kullanması aynı session veya kullanıcı kimliğini paylaşmaları anlamına gelmez. Toplam upstream quota yine ortaktır.
- Yenileme, login/session servisine doğrulanmış account bağlamında aittir; burada anonymous mint/refresh endpoint yoktur. Public bootstrap veya APK shared secret eklenmedi.
- Bearer çalınırsa kalan5 dakika replay riski vardır. Client logout/lifetime abort devam eden istemci HTTP'sini durdurabilir; **server-side bireysel revocation değildir**. `TMDB_SESSION_MIN_IAT` (Unix saniyesi, default0) önceki bütün session'ları reddeder. İmza key rotation tümünü iptal eder. Kullanıcı/session bazlı anlık revocation için issuer introspection veya bounded paylaşımlı denylist ayrı entegrasyon ister.
- Key rotation atomik server secret güncellemesi ve issuer/proxy koordinasyonu gerektirir; APK güncellemesi gerekmez. Mevcut token aynı secret kaydından sunucuya bağlanır; değer terminal/rapor/loga verilmez.

## Secret ve en küçük kurulum adımları

| Ayar | Gereken |
|---|---|
| `TMDB_READ_ACCESS_TOKEN` | Gen2'nin aynı mevcut token'ına bağlı server secret referansı; yeni TMDB token değil |
| `TMDB_SESSION_HMAC_KEY` | Ayrı server session imza anahtarı, en az32 byte; APK'da bulunmaz |
| `TMDB_SESSION_ISSUER` | Yetkili session üreticisinin tam kimliği |
| `TMDB_SESSION_MIN_IAT` | İsteğe bağlı bütün eski session'ları geçersizleştirme eşiği |
| `PORT`, `CORS_ALLOWLIST` | Node dinleme portu ve gerekiyorsa izinli web origin'leri |

1. Kullanıcı mevcut uygun sunucu/HTTPS hedefini ve güvenilir kimlik sağlayıcısını belirleyip dağıtım için açık onay vermeli. Henüz sağlayıcı seçimi yapılmadı; sırf bu geliştirme için yeni token veya yeni hosting satın almak zorunlu diye kabul edilmemeli.
2. Yetkili sunucu yöneticisi aynı mevcut TMDB token secret referansını runtime'a bağlamalı; değer kaynak, `.env`, build arg veya APK'ya yazılmamalı. Ayrı uygulama session issuer/key kurulmalı.
3. Tek process için mevcut API server build/start çalıştırılmalı; HTTPS ingress, log politikası ve kota izlemesi kurulmalı. Güvenilir ingress olmadan `trust proxy` açılmamalı. Doğrudan Node portu public olmamalı.
4. Doğrulanmış HTTPS origin ve gerçek kısa ömürlü session callback'i, mevcut `ProductShell.metadataAccess` injection noktasına bağlanmalı. Account değişiminde metadata context yeniden oluşturulmalı, önceki lifetime signal iptal edilmeli. Gen2 tarafındaki geçiş ayrıca yetkilendirilmelidir.
5. Canlı testler ve TMDB attribution tamamlanınca gerçek erişim kabul edilebilir. Bu adımlar henüz yapılmadı.

## Güvenlik ve performans sınırları

Upstream sabit `https://api.themoviedb.org/3/`; yalnız movie search ve numeric-ID detail+credits/similar. Serbest URL/path, provider/MAC/cmd/playback alanları kabul edilmez. Redirect izlenmez. POST gövdesi2 KB; upstream yanıtı1 MiB; timeout8 sn server/10 sn client. IP120/dk, doğrulanmış app+sub60/dk, upstream120/dk, en fazla4 pending upstream; aynı sorgular birleşir. Cache hit'leri de HTTP kimlik kotasını tüketir. Bounded bucket kapasitesi dolarsa fail-closed. IP yalnız RAM quota anahtarında; mevcut pino request serializer IP/header/body/subject içermez, yalnız request id/method/query'siz path ve response status yazar. Yeni route/parser exception/body fragment loglamaz. Ingress'in header/body/IP log politikası dağıtım öncesi ayrıca doğrulanmalıdır.

Client lifetime abort, shared server single-flight request'ini iptal etmez; başka bekleyen kullanıcılar için bounded request tamamlanabilir ve cache doldurabilir. Sunucu upstream timeout'u her durumda8 sn sınırıdır. Retry otomatik katalog taraması veya sonsuz loop üretmez. Gate cooldown sırasında yerel/önbellek metadata kullanılır, yeni istek fırtınası başlatılmaz.

Provider identity/revision eşleşmesi yerelde kalır; metadata wire yalnız title/year veya TMDB movie id/locale taşır. Strict matcher yanlış type/year/ID/ambiguous içerik eşleşmesini reddeder. Xtream/M3U/Stalker `İzle` mevcut callback/resolver üzerinden kalır. TMDB önerileri playable episode/movie sayılmaz. Film Info UI hemen yerel veriyi gösterir; geç/başarısız metadata arayüzü bloke etmez. Mevcut Türkçe→İngilizce title/overview fallback testlidir; gerçek görseller/oyuncular/puanlar canlı API'de doğrulanmış değildir.

## Kalıcı cache planı — ayrı küçük PR

Mevcut memory metadata TTL7 gün, search6 saat; local negative match cache6 saat, positive7 gün; server HTTP hataları negatif başarı olarak cache'lenmez. Sürüm/revision değişimi match cache'i geçersiz kılar. Restart'ta cache kaybı güvenli fallback üretir fakat ilave API yüküne neden olabilir.

Önerilen **yerel SQLite tasarım şeması** (bu tur oluşturulmadı):

```sql
CREATE TABLE tmdb_metadata_cache (
  kind TEXT NOT NULL, tmdb_id INTEGER NOT NULL, locale TEXT NOT NULL,
  schema_version INTEGER NOT NULL, payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, tmdb_id, locale, schema_version)
);
CREATE TABLE tmdb_catalog_match_cache (
  provider_scope TEXT NOT NULL, family TEXT NOT NULL, kind TEXT NOT NULL,
  catalog_id TEXT NOT NULL, catalog_revision TEXT NOT NULL,
  matcher_version INTEGER NOT NULL, input_fingerprint TEXT NOT NULL,
  result TEXT NOT NULL, fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY (provider_scope, family, kind, catalog_id, catalog_revision,
               matcher_version, input_fingerprint)
);
CREATE INDEX tmdb_metadata_expiry ON tmdb_metadata_cache(expires_at);
CREATE INDEX tmdb_match_expiry ON tmdb_catalog_match_cache(expires_at);
```

Payload sadece doğrulanmış metadata DTO; playback URL/credential yok. `provider_scope` yerel dahili kimliktir, sağlayıcı URL veya parola değildir. `input_fingerprint` mevcut normalize başlık/original title/yıl/TMDB hint boyutlarının cache parmak izini korumalıdır. TTL ve clock rollback kontrolü read sırasında yapılır; bozuk JSON/schema silinir. Provider silinince match kayıtları; katalog revision değişince eski match sonuçları; matcher/schema version değişince ilgili eski kayıtlar geçersiz olur. Metadata provider'dan bağımsızdır. Atomik UPSERT, boyut/kayıt kotası ve LRU/expiry temizliği ayrı regresyon testleriyle uygulanmalıdır. Merkezde birden çok replica için bu yerel SQLite tasarımı shared quota yerine geçmez.

## Doğrulama ve açık riskler

Yerel: proxy32/32, loopback HTTP15/15, foundation57/57, Film Info34/34; mobile/API TypeScript; format kontrolü. HTTP testleri gerçek Express auth→parser→route zincirini çalıştırır, upstream TMDB mock'tur. CI exact-SHA Quality sonucu PR'da verilir. Mevcut Quality provider/orientation/Focus/Player regresyonlarını da çalıştırır; bu hatta bu dosyalar değiştirilmez.

Canlı kabul için HTTPS + yetkili gerçek session + gerçek TMDB yanıtı gereklidir: Türkçe özet/poster/backdrop/oyuncu/yönetmen/süre/yıl/tür/puan, gerektiğinde İngilizce fallback, yanlış IPTV eşleşmesinin reddi, her üç provider'da mevcut İzle callback'i ve hassas veri içermeyen log/APK. Henüz bunlar fiziksel/canlı ortamda test edilmedi. TMDB onaylı logo + attribution ve ticari kullanım değerlendirmesi release önkoşuludur; mevcut metin/bağlantı tek başına logo gereğini tamamlamaz. Resmî kaynak: https://developer.themoviedb.org/docs/faq (17 Ekim 2026 kontrol edildi).

Öncelikli açık engeller: güvenilir issuer, onaylı HTTPS hedefi, mevcut secret'ın server bağlantısı. Sonraki küçük PR: bu üç bileşenin yetkili entegrasyonu ve canlı Film Info kanıtı; kalıcı SQLite cache ayrı kalır. Native TV fiziksel kabulüne ilişkin PASS verilmez.
