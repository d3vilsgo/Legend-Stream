# TMDB kontrollü bağlantı — uygulama ve işletim raporu

## Gerçek erişim durumu

**CANLI TMDB BAĞLANTISI DOĞRULANMADI.** Proxy ve Film Info adaptörü uygulanmıştır; dağıtılmış HTTPS hizmeti, güvenilir uygulama oturumu üreticisi ve mevcut Gen2 token'ının sunucu secret kaydına erişimi bu çalışmada sağlanmamıştır. Uygulama varsayılan olarak bağlantısızdır, IPTV bilgileri ve mevcut İzle callback'i çalışmaya devam eder. Mock testler gerçek TMDB veya TV kabulü değildir.

Yeni token oluşturulmadı/istenmedi. Hiçbir gerçek token değeri okunmadı veya kaynak, `.env`, test fixture ya da APK'ya kopyalanmadı. Test credential değerleri yalnız sentetiktir.

## Kaynak kapısı

| Kaynak | Doğrulanan HEAD | Quality |
|---|---|---|
| PR #140 | `b396fbfcccc0e8205dcaec43de088d0dcba5c7d7` | 38978779621 SUCCESS |
| PR #141 | `70ca5c533e9abdbee4388225c7b140ce9af81e20` | 39024167434 SUCCESS |
| Gen2 main | `b6026566c0a772c6b1b53f48a4f108a89396714d` | Bu çalışmada çalıştırılmadı |

Yeni branch `feature/r19-tmdb-secure-proxy`, #141 HEAD'inden açılmıştır. Mevcut PR'lar değiştirilmez/merge edilmez. Gen2 `TmdbClient.kt`, `BuildConfig.TMDB_API_TOKEN` üzerinden doğrudan Authorization header oluşturuyor. Bu APK yaklaşımı XPlayer'a taşınmamıştır. Gen2 bu PR'da değiştirilmediği için iki uygulamanın merkezi proxy'ye geçişi henüz tamamlanmış değildir.

#141'in `MovieInfoService`, `MovieInfoModal`, `accessPolicy`, matcher/cache ve gerçek Xtream/M3U/Stalker film açma callback'leri denetlendi. Eksik halka HTTP adaptörü ve kimlik doğrulamalı sunucu erişimiydi. Mevcut API sunucusunda CORS ve IPTV provider doğrulaması uygulama oturumu sayılmaz.

## Değişiklikler

- `artifacts/api-server/src/lib/tmdb/proxy.ts`: sıkı işlem/alan izin listesi, session verifier, sınırlı oran sayacı, sabit TMDB upstream, yanıt projeksiyonu, 8 sn timeout, 1 MiB yanıt sınırı, 429 cooldown, bounded cache/single-flight.
- `artifacts/api-server/src/routes/tmdb.ts`, `routes/index.ts`: `POST /api/tmdb/metadata`; eksik sunucu yapılandırmasında 503; geçersiz oturumda 401. Sabit güvenli hata kodları, `no-store` HTTP yanıtı.
- `artifacts/legendstream-xplayer/lib/tmdbProxy/transport.ts`: HTTPS proxy adaptörü, kısa ömürlü uygulama oturumu callback'i, minimal DTO, 10 sn timeout ve 429 dönüşümü. TMDB token konfigürasyonu kabul etmez.
- `components/tmdb/MovieInfoServiceProvider.tsx`, `MovieInfoModal.tsx`, `ProductShell.tsx`: açık opsiyonel erişim enjeksiyonu; yapılandırma verilmedikçe mevcut bağlantısız service. Provider/API/Player/Back/Focus/orientation değiştirilmedi; shell yalnız metadata context'ini sarar.
- `tests/tmdbSecureProxyScenarios.ts`, `.github/workflows/quality.yml`: davranış testleri ve yeni branch/base Quality tetiklemesi.

## Erişim sözleşmesi

Sunucu `HS256` imzalı JWT doğrular: `iss` yapılandırılmış issuer, `aud=legendstream-tmdb`, `app=xplayer|gen2`, anonim `sub`, integer `iat/exp`, maksimum 300 sn ömür; gelecekte başlangıç, süresi dolmuş/geçersiz imza ve algoritma reddedilir. İmza sabit zamanlı karşılaştırılır. Bu servis public oturum üretmez. IPTV kullanıcı adı/parolası uygulama hesabı yerine kullanılamaz.

**Dağıtım önkoşulu:** güvenilir hesap/cihaz kayıt servisi kullanıcı/cihaz yetkisini doğrulayıp kısa ömürlü session üretmelidir. Statik app key APK içine konulmaz. Oturum çalınması 5 dakikalık bearer replay riski taşır; TLS, güvenli oturum saklama, logout/yenileme ve gerekirse cihaz attestation/revocation issuer tarafında kurulmalıdır. Origin/CORS uygulama kimliği kanıtı değildir.

Server-only secret injection (secret manager/orchestrator, dosya veya APK değil):

| Ayar | Kaynak / anlam |
|---|---|
| `TMDB_READ_ACCESS_TOKEN` | Gen2 ile aynı **mevcut** token secret kaydı; değeri rapor/loga yazılmaz |
| `TMDB_SESSION_HMAC_KEY` | Ayrı sunucu oturum imza anahtarı, en az 32 byte; TMDB token'ı değildir |
| `TMDB_SESSION_ISSUER` | Güvenilir session issuer'ın tam eşleşen kimliği |
| `CORS_ALLOWLIST` | Gerekli web origin'leri; native erişimin auth kontrolünü değiştirmez |

App composition'da `ProductShell metadataAccess={{origin: HTTPS_ORIGIN, getSession: trustedSessionProvider}}` kullanılır. Callback mevcut uygulama login/session entegrasyonundan gelmelidir; bu depoda böyle bir issuer bulunmadığı için üretim caller'larına sahte callback eklenmedi. Account değişiminde context re-key/recreate edilerek session'a bağlı yaşam döngüsü sonlandırılmalıdır. Provider geçişi mevcut katalog identity/revision korumasında kalır.

## Endpoint ve veri sınırları

`{op:"search",title,year?}` yalnız `/3/search/movie`; `{op:"detail",id,locale:"tr-TR"|"en-US"}` yalnız `/3/movie/{id}?append_to_response=credits,similar`. Keyfi host/path/query, provider kimliği, URL, username/password, Stalker MAC/cmd veya playback alanı kabul edilmez. Redirect izlenmez. Yanıtta yalnız metadata alanları projekte edilir; TMDB ID gerçek playback ID olmaz. Series bu ilk adaptör kapsamı dışındadır.

Türkçe açıklama yoksa #141 service'i aynı film ID'sinin İngilizce alanlarına düşer. Title/year/kind doğrulaması mevcut strict matcher'dadır. Belirsiz eşleşmede IPTV bilgileri kalır. TMDB önerileri oynatılabilir içerik sayılmaz. Arama yalnız ilk sayfa sonuçlarıyla sınırlıdır; eksik sonuçta güvenli biçimde eşleşme bulunamayabilir.

## Cache ve işletim

İstemci mevcut 7 günlük bounded memory cache + negative match cache'ini kullanır. Sunucu metadata 7 gün, search 6 saat, en fazla 512 kayıt tutar. En fazla 4 upstream request eşzamanlı, aynı sorgular tek istek; process genelinde 120 upstream/dk, IP 120/dk ve doğrulanmış app+subject 60/dk. Maksimum 2048 rate bucket; dolulukta fail-closed. 429 Retry-After saniyesi en çok 1 saat; yoksa 60 sn. Başarısız cevaplar cache'e yazılmaz. Global cooldown yeni upstream isteklerini durdurur; cache hit'leri kullanılabilir.

**Kalıcı cache bu PR'da yoktur.** Restart cache'i sıfırlar. Tek instance ilk dağıtım için sınırdır. Birden fazla replica öncesi Redis/shared cache, atomik rate limit ve global cooldown gerekir; aksi halde kota replica sayısıyla çarpılır. Kalıcı metadata tablosu `kind,id,locale,payload,fetchedAt,expiresAt,schemaVersion` üzerinden; provider-match tablosu mevcut provider/revision identity'siyle ayrı tutulmalıdır. SQLite istemci için; merkezi metadata cache için Redis/PostgreSQL uygundur. Geçersiz JSON/şema ve süresi dolan kayıtlar kullanılmamalıdır.

Mevcut API sunucusunun Node build/start süreci kullanılır. HTTPS ingress, secret injection/rotation, issuer, health/readiness takibi, process supervision, anonim status/latency/429 sayaçları ve upstream kota alarmı gerekir. Reverse proxy gerçek istemci IP'sini yalnız güvenilir ingress'ten sağlamalı; Express trust proxy körlemesine açılmamalıdır. NAT arkasında IP limiti paylaşımlıdır. Proxy body/header ve upstream response logları kapalı kalmalıdır. Mevcut pino request serializer yalnız query'siz path/method/id; yeni route error nesnelerini loglamaz. Operasyon maliyeti: sürekli Node hizmeti/TLS ve ileride shared cache/issuer bakımı; bir APK ayarıyla tamamlanamaz.

## Doğrulama ve kabul

Yerel: yeni proxy 29/29, mevcut foundation 57/57, Film Info mock 34/34; mobile TypeScript ve API server project-reference TypeScript. Quality exact-SHA sonucu yeni PR raporunda verilir. Bunlar gerçek TMDB erişimi değildir.

Deployment sonrası ayrı canlı kabul: yetkisiz istek401; eksik secret503; izin dışı alan400; kota429; doğrulanmış bilinen filmde Türkçe açıklama/görsel/oyuncu/yönetmen/süre/yıl/tür/puan; eksik Türkçe alanda İngilizce fallback; yanlış provider ID/yılda yerel bilgi; her üç provider'da İzle'nin mevcut resolver üzerinden açılması; token/provider bilgilerinin request/response/log/APK'da bulunmaması. Onaylı TMDB logo/attribution ve ticari kullanım şartları canlı UI yayını öncesi tamamlanmalıdır. Mevcut attribution metni/about bağlantısı tek başına logo gereğini karşılamaz.

Gerçek TV kumandası, Player çıkışı veya fiziksel playback sürekliliği bu işin kabulü değildir; Native TV Physical PASS verilmez. Sonraki küçük PR: gerçek issuer/deployment bağlama ve canlı Film Info kanıtı; ardından kalıcı cache. Player/Back düzeltmeleri ayrı kalmalıdır.
