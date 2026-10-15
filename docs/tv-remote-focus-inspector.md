# TV Remote Input & Focus Inspector

Base gate: PR #136 OPEN / DRAFT / NOT MERGED, remote HEAD `d9f279ad4033c69906397a76750401a2d7d575ec`. Önceden verilen `338e73d...` güncel HEAD değildir. Base exact-SHA Quality #1218 / run 38713863010 SUCCESS; Universal APK #496 / run 38713869502 SUCCESS. Bunlar fiziksel kabul değildir. #491 Homatics Physical FAIL kararı korunur.

## Kaynak denetimi

| Dosya → kanıt | Kullanıcı etkisi → yeniden üretim | Kök neden → küçük düzeltme → test |
|---|---|---|
| Native modül Window.Callback sadece playback keylerini JS'e gönderiyordu; yön/OK çoğunlukla native uygulanıyordu | Videoda tuş ile tepki bağlanamıyordu; Home'da dört yön/OK dene | Teşhis olayı yoktu; gerçek native dispatch giriş/sonuç ayrı gözlenir, orijinal Boolean aynen döner; event separation testleri |
| RN 0.81.5 standart paket index.js TVEventHandler/useTVEventHandler export etmez; app.json eski mimari | Varsayılan TV fork API'sine güvenilemez | Mevcut Kotlin Window.Callback + ViewTreeObserver kullanılır; yeni TV API'si varsayılmaz; Android release derlemesi |
| FocusButton, TVPreviewPressable, PlayerRemotePressable gerçek odak için native köprüyü kullanır; Paper surfaceId=-1 JS focus/blur hattını kesebilir | onFocus prop'u tek başına fiziksel kanıt değildir | Yeni paralel/sentetik focus yaratılmaz; aynı gerçek focus observer anonim ID yayar; değişti/değişmedi testleri |
| ResponsiveContentNav onSelect mevcut ekran state'ine gider; Paged/Stalker view state'i ayrı | Aktif sekme fiziksel odak sanılabilir | onPress çağrısı ve commit sonrası ekran state değişimi ayrı kayıt; screen-is-not-focus testi |
| TVPreviewFocus modal scope ve restore yönetir; PagedCatalogViews kategorisi gerçek Modal | Activity callback Dialog tuşlarını görmez | RN 0.81.5 public ReactModalHostView.getDialog getter'ı runtime üzerinden çözülür; Dialog Window callback yalnız gözlemler ve eski callback'e iletir; ayrı pencere paneli. OEM/Dialog gerçek testi zorunlu |
| CompatibilityVideoPlayerV2 root Back sahibidir, Chrome ayrıca Back tüketmez | Panel kapandı mı/player çıktı mı belirsiz | Root Back kararı ile controls/panel state commit ve player mount/unmount ayrı kayıt; mevcut action/state/LibVLC değiştirilmez; ownership regresyonları |
| Telefon TV Preview ayrı sanal controller kullanır | Fiziksel giriş ile sanal komut karışabilir | Inspector UI/collector yalnız Platform.isTV; telefon/Preview mevcut yolları korunur; 32 Preview senaryosu |

## Kullanım

TV Ayarlar → **Kumanda ve Odak Test Modu** → aç. Varsayılan kapalıdır; kalıcı tercih veya BuildConfig.DEBUG şartı yoktur. Ayarlar'dan kapatma, daraltma ve son 20 olay görünümü seçilir. Panelde focusable öğe ve pointer hedefi yoktur; kumandaya yeni kısayol eklemez, odağı çalmaz. Kategori modalı paneli aynalar; tek collector vardır.

Panelde ayrı kanıtlar:

- `input`: Window'a gerçekten gelen DOWN / UP / REPEAT; native olay sıra numarası ve allowlist tuş adı. Olay algılandı demek odak hareketi değildir.
- `focus`: gerçek Android global focus değişimi veya açılış snapshot'ı. Önceki/yeni anonim ID ayrı gösterilir.
- `dispatch`: mevcut Window callback sonucu. `işlendi` bir onPress/navigasyon/oynatma başarısı değildir. Odak değişmediyse açıkça yazılır.
- `action`: ortak gerçek React onPress callback'i döndü; root player Back kararı (`back-panel`, `back-controls`, `back-exit`); ayrıca controls/panel state commit ve player mount/unmount. `back-exit` çıkış isteğidir; katalog screen state ve unmount dönüşü doğrular. Oynatma motorunun işi tamamladığı iddia edilmez.
- `screen`: Paged/Stalker gerçek view state commit'i; focus'tan bağımsız.

Sabit navigasyon/player eylemleri allowlist kimliklidir. Diğer katalog/kategori hedefleri mevcut semantik focus ID’nin oturuma özel tuzlu SHA-256 özetinden `target:N` olur; inspector oturumu içinde aynı semantik hedef remount olsa da aynı anonim ID üretilir. Ham kimlik tutulmaz/yayılmaz. Semantik kaydı olmayan legacy hedefler native tag kullanır ve yalnız mount ömründe kararlıdır. İçerik veya sağlayıcı kimliği teşhis kaydına girmez. Mevcut uygulama focus restore semantik ID'leri değiştirilmez.

Tuşlar UP/DOWN/LEFT/RIGHT/OK/BACK/PLAY_PAUSE/PLAY/PAUSE/MENU/STOP/NEXT/PREVIOUS; standart gamepad button aralığı GAMEPAD, diğerleri OTHER. HOME, ses, güç veya firmware'in uygulamaya iletmediği olaylar izlenemez. Sessizlik, tuşa basılmadığını kanıtlamaz. Ekrandaki panelden sistem seviyesinde yakalama iddiası çıkarılamaz.

## Gizlilik ve davranış sınırı

Son 20 kayıt yalnız JS belleğinde; kapatmada temizlenir. Export, console/file/network/AsyncStorage yazımı yoktur. Kullanıcı adı, şifre, MAC, token, URL, başlık ve provider ID kabul edilmez. Native teşhis DTO'su yalnız tuş/anonim focus/scope/context alanları taşır; JS ikinci allowlist ile doğrular. Metin giriş tuşlarının karakteri gösterilmez.

Observer dispatch sonucunu değiştirmez; playback setter'ı, ek BackHandler veya ikinci remote action tüketicisi yoktur. Teşhis çizimi ve bellekte kayıt tutmanın küçük çalışma maliyeti vardır; fiziksel zamanlama eşdeğerliği CI ile kanıtlanmaz.

## Test ve fiziksel tur

Yeni 27 davranış testi: yönler/OK/Back/medya/gamepad, gerçek focus ayrımı, active screen ayrımı, modal/scroll sonrası gözlem, player focus/Back, aç-kapa/temizleme, 20 sınırı, abonelik temizliği ve gizlilik. Mevcut üretim Java yön politikası 33, remote 25, TV Preview 32 senaryo korunur. TypeScript ve exact-SHA Quality zorunludur.

Bu testler gerçek Window.Callback, RN onPress köprüsü, Dialog reflection, ViewTreeObserver, odak çerçevesi, gerçek scroll, OEM event iletimi ve VLC eylem sonucunu çalıştırmaz. Bunlar Homatics'te doğrulanmalıdır:

1. Kapalı başlangıç; TV Ayarlar'dan aç; panel odak almamalı.
2. Home içerik → üst menü → Live → Filmler → Diziler: input, focus, onPress, screen ayrı görünmeli.
3. Kategori çekmecesi aç; dört yön/OK/Back olayları ve scope görülmeli.
4. Scroll/paging sonrası önceki/yeni anonim focus gözlenmeli.
5. Player OK → controls-shown → player focus; list/audio/CC/fit/codec seç; onPress yalnız seçim kanıtıdır, oynatma sonucunu ayrıca gözle.
6. Back panel → controls → exit: root karar + committed state + katalog screen dönüşünü kaydet.
7. Ayarlar'dan daralt/geçmiş/kapat; kapalıyken yeni kayıt oluşmamalı.
8. Xtream Live/VOD/Series, M3U ve Stalker ayrı; telefon ve Preview regresyonları ayrı tur.

Homatics fiziksel kanıtı olmadan Inspector veya Native TV PASS verilmez. Hiçbir PR merge edilmez.
