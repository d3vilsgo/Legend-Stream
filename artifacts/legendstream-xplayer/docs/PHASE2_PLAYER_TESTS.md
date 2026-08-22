# LegendStream XPlayer — Faz 2 Player Test Matrisi

Bu belge, stabil player özelliklerinin izole biçimde doğrulanması için tutulur.

## Kilitlenen özellikler

- [x] VLC player açılışı / temel playback
- [x] Ekran ölçekleme: FIT / FULL / ORIG / 16:9 / 4:3
- [x] Android Picture-in-Picture (PiP)
  - [x] PiP içinde video + ses devam eder
  - [x] PiP büyütülerek uygulamaya dönüşte playback devam eder
  - [x] PiP penceresi kapatıldığında arka plandaki ses durur

## Sıradaki izole test

- [ ] Sol dikey swipe → ekran parlaklığı
- [ ] Sağ dikey swipe → Android medya sesi
- [ ] Swipe sırasında HUD yüzdesi
- [ ] Basit tap → player kontrollerini göster/gizle davranışı bozulmamalı

## Son regresyon turu

Gesture testi geçtikten sonra Live / VOD / Series, AUTO-HW-SW codec, altyazı/ses parçası, resume/history, download ve orientation birlikte test edilir.
