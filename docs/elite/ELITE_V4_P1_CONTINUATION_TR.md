# Elite V4 P1 görsel devam teslim kaydı


## Elite V4 P1 devamı — 23 Ekim 2026

Başlangıç HEAD: `e6b4eab367a6816f1f2011c28a9941fc9fb2e368`; PR #143 ve mevcut branch/base/Draft korunur.
Sidebar kompakt 68 dp, genişken en çok 208 dp/viewport %30; normal akışta yer ayırır, kısa ekranda menü kaydırılır. Home gerçek içerik genişliğini ölçer. Hero kısa ekranda tek satır başlık/özet ve sınırlı aksiyonlar; yatay/dikey scrim. Raflar ortak genişlik, footer ritmi ve komşu raflara açık Focus hedefleri kullanır. V4 Focus 1 dp turkuaz ve hafif ışıma; ölçek büyütme kaldırıldı. Preview adapter isteğe bağlı focusVisualStyle ile V4 görünümünü korur; varsayılan V3 stili aynı kalır.
Üretim host 16/16; Home/Focus model 13/13; TV Preview 32/32; yerel TypeScript PASS. Assertion gevşetme/skip yok; animated width.value beklentisi normal-akış sayısal width sözleşmesine güncellendi. Exact-SHA Quality ve aynı commit Universal APK push sonrası doğrulanacak; bu kayıt CI SUCCESS iddiası değildir.
Telefon/tablet TV Preview ve Native TV kaynak/host kapsamı; Android/Google TV/Box fiziksel kabulü bu değişiklik için NOT TESTED / DEFERRED_RC. P0 kullanıcısının bildirdiği V3/V4 ve Sidebar geçiş kabulü korunur; tarihsel Physical FAIL kayıtları silinmez. Diziler ve Home dışı Sidebar aksiyonları mevcut V3 handoff yolunu kullanmaya devam eder; tam V4 ekran parity henüz tamamlanmadı. GEN2, sağlayıcı/TMDB/EPG/Player servisleri ve V3 ekranları değişmedi. Gerçek cihaz/emülatör ekran görüntüsü üretilmedi.

Değişen üretim dosyaları: EliteV4Sidebar.tsx, EliteV4Home.tsx, EliteV4Hero.tsx, EliteV4ContentRail.tsx, EliteV4FocusSurface.tsx; ortak TVPreviewFocus.tsx yalnız isteğe bağlı V4 Focus stili alanıyla genişletildi. eliteV4ProductionHostScenarios.mjs gerçek bileşenleri derleyerek kalan alan ölçümü, kısa ekran, raflar arası yönler, V3/V4 rota dönüşü ve ortak Preview stili izolasyonunu sınar. Host testler React Native layout motoru/cihaz piksel kabulü değildir.
