# LegendStream XPlayer

LegendStream XPlayer, kullanıcıların **kendilerine ait ve kullanma hakkına sahip oldukları** IPTV kaynaklarını Android ve web önizlemesinde açmaları için geliştirilmiş bir oynatıcıdır. Depo yayın, film, dizi veya abonelik içeriği barındırmaz; erişim hakkı ve kaynakların hukuka uygun kullanımı kullanıcıya aittir.

## Kaynaklar ve depo yapısı

- M3U listeleri, Xtream hesapları ve Stalker portalları desteklenen sağlayıcı türleridir. Sağlayıcı davranışları ve özellikleri aynı değildir.
- `artifacts/legendstream-xplayer/`: Expo/React Native mobil uygulama, web önizlemesi, testler ve oynatıcı belgeleri.
- `artifacts/api-server/`: web ortamındaki Xtream istekleri için sınırlı API proxy. Android'in doğrudan sağlayıcı ulaşımının yerini almaz.
- `lib/`: ortak şema, API ve veri katmanı paketleri; `.github/workflows/`: Quality ve Android derlemesi.

## Gereksinimler ve kurulum

Node sürümü `.nvmrc` dosyasında (`22.13.0`), pnpm sürümü kök `package.json` dosyasında (`10.28.1`) sabittir. Android APK için Android SDK/NDK ve Java 17 gerekir; ayrıntılı araç kurulumu `android-apk.yml` içindedir.

```bash
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
```

Mobil test komutları `artifacts/legendstream-xplayer/package.json` içindeki `test:*` scriptleridir. Örneğin:

```bash
pnpm --filter @workspace/legendstream-xplayer test:epg
pnpm --filter @workspace/legendstream-xplayer test:catalog-parity
pnpm --filter @workspace/legendstream-xplayer test:xtream-xmltv-parser
```

Quality workflow'u bu scriptleri ve ayrı güvenlik/derleme kapılarını PR üzerinde çalıştırır; yerel tüm paketleri görmek için `pnpm --filter @workspace/legendstream-xplayer run` kullanın.

## Önizleme ve Android APK

Web önizlemesi için `pnpm --filter @workspace/legendstream-xplayer dev` komutunu çalıştırın ve Expo'da web hedefini seçin. Web Xtream istekleri tarayıcı kısıtları nedeniyle `pnpm --filter @workspace/api-server dev` ile açılan API proxy üzerinden gider; izinli web origin'lerini `CORS_ALLOWLIST` ile ayarlayın. API sunucusu güvenilir ters proxy arkasında varsayılan olarak bir hop kabul eder (`TRUST_PROXY_HOPS=1`); doğrudan erişimde veya farklı proxy zincirinde bu sayıyı dağıtımınıza göre ayarlayın.

Android APK üretimi GitHub Actions **Android APK** (`.github/workflows/android-apk.yml`) workflow'unun manuel tetikleyicisiyle yapılır. `dual_abi=true` arm64-v8a ve armeabi-v7a test APK'larını üretir; varsayılan test derlemesi yalnız arm64-v8a'dır. `catalog_benchmark=true` yalnız manuel, arm64 test derlemesinde dahili katalog benchmark yolunu açar ve `dual_abi` ile birlikte kullanılamaz. `v*` etiketi tam sürüm APK/AAB akışını çalıştırır. İndirilen artifact'ın workflow SHA'sını hedef commit ile karşılaştırın.

## Güvenlik

Sağlayıcı kimlik bilgilerini örnek veya log olarak eklemeyin. Mobil tarafta sırlar SecureStore üzerinden yönetilir; tanılama çıktılarında URL ve kimlik bilgileri redakte edilir. Quality'deki console kullanım koruması yeni doğrudan `console.*` çağrılarını denetler. API proxy'de origin kısıtı, istek doğrulaması ve Xtream hız sınırı bulunur; üretimde proxy hop ayarını gerçek ağ topolojisine göre yapılandırın.

**English summary:** LegendStream XPlayer plays user-provided, lawfully accessible M3U, Xtream and Stalker sources. The repository hosts no media. Use the pinned Node/pnpm versions, run Quality before building, and keep provider secrets out of source and logs.
