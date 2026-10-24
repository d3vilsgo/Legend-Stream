# Doğrudan TMDB istemcisi

XPlayer mobil uygulaması TMDB API v3'e HTTPS üzerinden doğrudan bağlanır. `TMDB_API_TOKEN` GitHub Actions repository secret'ı Android build ve Quality live acceptance adımlarına aktarılır. APK build'inde `EXPO_PUBLIC_TMDB_API_TOKEN` Expo bundle'ına gömülür. **Bu modelde token gizli değildir; APK'yı inceleyen herkes çıkarabilir ve başkaları kullanabilir.** Secret yalnızca kaynak kodu/CI yapılandırmasında tutulur; runtime loglarında veya test çıktısında basılmaz. Kullanım/rate-limit takibi TMDB hesabı tarafından yapılmalıdır.

İstemci `tr-TR` arama ve detay istekleri yapar, eksik metin alanları için aynı medya kimliğinde `en-US` fallback kullanır. Eşleşme başlık ve bilinen yılın kesin eşitliğini, medya türünü ve provider TMDB ID'sinde detail doğrulamasını şart koşar. İstemci cache'i 7 gün TTL, istek gate'i, 10 saniye timeout ve sabit hata kategorileri kullanır. TMDB başarısız olursa mevcut provider metadata ve playback akışı devam eder.

Film/TV search, detail+credits+similar+videos ve TV season episode uçları desteklenir. TMDB metadata hiçbir durumda playback ID/URL üretmez. TV bölüm oynatma, mevcut provider episode resolver'ını kullanır.
