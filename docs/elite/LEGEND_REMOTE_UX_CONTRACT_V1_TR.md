# LEGEND REMOTE UX CONTRACT — V1

## Mevcut altyapı ve sınır

React Native 0.81.5, Expo 54. Native KeyEvent köprüsü `modules/legendstream-tv-remote`, `useNativeTvTarget`, `TVPreviewFocus`, `NativeTVFocusScope` ve player'ın mevcut Back sahipliği kaynakta vardır. react-native-tvos/useTVEventHandler mevcut varsayılmaz. Mobil TV Preview JS controller'ı fiziksel Android focus'un yerine geçmez.

Native `Window.Callback` şu anda D-pad hareketi için `move()` ve OK için `performClick()` kullanıyor. Bu çalışan davranış ilk tasarım PR'ında değiştirilmez; tüm normal D-pad'i gereksiz ele geçirmeme hedefi, ölçülmüş başarısız durumlar için sınırlandırılacak ayrı mimari çalışmadır.

## Olay hattı

Android KeyEvent → deviceId/downTime/keyCode/action/repeatCount kimliği → tek tüketim kararı → aktif bağlamda semantic action → gerçek native focus veya mevcut onPress → inspector kanıtı.

DOWN/UP/REPEAT ayrı tutulur. Tek DOWN bir seçim çalıştırır; OK uzun basışla seri oynatma başlatmaz. Yön tekrarları doğal uzun basışı korur; sabit debounce ile tüm tekrarı engellemek yasaktır. UP hareket üretmez. Activity/dialog çift teslimi aynı kimlikle bir kez işlenir. Input gözlemcisi olayı tüketmez ve focus almaz.

| Tuş | Katalog | Player kontroller gizli | Kontroller / panel açık |
|---|---|---|---|
| OK | Gerçek odaktaki onPress | Kontrolleri göster, tanımlı kontrol hedefine odak | Gerçek odaktaki mevcut action |
| Sol/Sağ | Ölçülen komşu | VOD seek; Live'da kontrolleri göster | Scope içinde komşu; progress bağlamında seek |
| Yukarı/Aşağı | Komşu; üst sınırda rail/başlık | Live'da önceki/sonraki; VOD'da kontroller | Panel/araç komşusu |
| Back | Açık drawer → detay seviyesi → önceki bölüm | Player'dan çıkış | Üst panel → dock'u gizle → player çıkışı |
| Play/Pause | Ön plan playback varsa mevcut politika | Aynı mevcut playback state | Aynı mevcut playback state |
| Menu | Varsa kategori/sıralama bağlamı | Mevcut seçenek paneli | Geçerli bağlamsal seçenek |
| Rakam | Yalnız desteklenen Live bağlamı | Kanal numarası buffer | Input paneli önceliği; desteklenmiyorsa açıklama |

Rakam/zapping politikası tasarım hedefidir; bu PR yeni native tuş desteği eklemez. Son seçim kazanır; eski kanal çözümlemesinin geç cevabı yeni yayını değiştiremez. İlk/son kanalda wrap ancak açık ürün tercihiyle; varsayılan wrap yoktur. Provider create_link/cancel/session yaşam döngüsü yeniden yazılmaz.

## Focus ve Back

- Focus ≠ Selected ≠ Active; inspector üç durumdan yalnız ölçtüğünü gerçek focus diye raporlar.
- ID provider bilgisi, URL, MAC, token veya içerik başlığı taşımaz; anonim kararlı UI kimliği kullanılır.
- Sanallaştırılmış hedef detach olunca kaydı silinir. Layout/asset yüklenmesi valid mevcut odağı değiştirmez.
- Sadece açık scope geçişi ve kullanıcı navigasyonu restore isteyebilir; bekleyen restore yeni fiziksel input ile geçersizleşir.
- Back tek olayın tek sahibidir. Native back ile RN BackHandler aynı basışı iki kez ilerletemez. Katalog player açıkken olayı tüketmez.
- Exit kalıcı kayıt veya orientation restore süresince kullanıcıyı sonsuz bekletemez. Üretim fix'i gerçek olay hattı üzerinden ayrı test edilir.

## Açık P0 fiziksel kusurlar

Kullanıcı Homatics'te player'dan Back ile çıkamadığını doğruladı. Videoda gizli player durumunda none↔target focus döngüsü görülüyor. APK/SHA eşleştirmesi teyit edilmedi; bu bulgular belirli yeni SHA üzerinde çözülmüş sayılmaz. Kaynakta Back sahiplik ve senkron snapshot guard'ları bulunması fiziksel kusurun kapandığı anlamına gelmez. Bu tasarım PR'ı ikisini düzeltmez ve PASS iddia etmez.

## Test planı

Tek basış/uzun basış/UP/çift teslim; rail↔katalog; dört yön; OK aynı ID; scroll/paging/resize; panel aç/kapat; Back üç aşama; hidden idle 30 sn; exit sonrası aynı ID; kaynak değişimi; Xtream/M3U/Stalker; telefon orientation; tablet/Preview; inspector açık/kapalı. Önce saf reducer/JVM, sonra Android entegrasyon, sonra Homatics fiziksel video + exact APK/SHA. JS/JVM testi Android requestFocus/firmware'i kanıtlamaz.
