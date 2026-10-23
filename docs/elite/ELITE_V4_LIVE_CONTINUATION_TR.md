# Elite V4 Canlı TV devam teslim kaydı


## Elite V4 Canlı TV — Xtream/M3U devam dilimi, 23 Ekim 2026

Başlangıç HEAD `f63817c895b80c1a50b3fba5db283ff98254b864`; PR #143 OPEN/DRAFT ve aynı integration branch/base korunur. Kullanıcının “Devam et” talimatıyla global entegrasyon sürdürülür; yeni fiziksel test veya Universal APK kapısı açılmaz.

Tamamlanan kaynak: Sidebar Home/Live arasında V4 içinde yönlenir; seçili menü ve RIGHT hedefi aktif ekrana bağlıdır. Yeni EliteV4LiveCatalog, mevcut useCatalogPage ve kategori deposunu tüketir; Home örnek listesine/24 kanal sınırına bağlanmaz. Xtream/M3U için kategori, arama, sayfa devamı, hata/boş/yüklenme, mevcut EPG/favoriler, odakla seçim ve OK ile gerçek resolver handoff bulunur. İnce V4 Focus korunur; geniş alanda yayın bilgi paneli, dar alanda erişilebilir favori aksiyonu vardır. Home/Live Back, aramayı kapatma, Player Back sahipliğine müdahale etmeme ve Preview focus restore bağlandı. Route/provider değişiminden sonra eski resolve yanıtı Player açamaz; yabancı provider kanal DTO'su reddedilir.

Otomatik yerel kanıt: V4 ana üretim host 18/18 + yeni Live host 13/13; Home/model 13/13; TV Preview 32/32; Native focus hook host 9/9; TypeScript ve hedefli Prettier PASS. Yeni host dosyası mevcut Quality'nin çalıştırdığı eliteV4ProductionHostScenarios.mjs içinden import edilir. Home varsayılan RIGHT=hero beklentisi korunur, Sidebar'ın dinamik contentFocusId sözleşmesi ayrıca test edilir. Assertion gevşetme/skip yok. Final exact-SHA Quality push sonrası run logundan doğrulanır; bu kayıt gelecekteki CI sonucunu PASS varsaymaz.

Eksikler/sonraki sıra: V4 Movies, Series, Continue Watching ve Settings tam ekranları; V4 Stalker Live adaptasyonu. Bu menüler mevcut V3 handoff yolunda kalır; V4 ekran parity bütünü PARTIAL. V3 üretim ekranları ve provider/TMDB/EPG/Player servisleri değiştirilmedi; GEN2 incelenmedi. Canlı kaynak oynatımı ve gerçek Android pencere/FocusFinder davranışı host testi değildir.
Fiziksel kabul NOT TESTED / DEFERRED_RC; P0 kullanıcı kabulü ve tarihsel Native TV Physical FAIL kayıtları korunur. Gerçek cihaz ekran görüntüsü ve yeni Universal APK bu dilimde üretilmedi. Önceki APK #530 bu yeni kaynak dilimini içermez.
