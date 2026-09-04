---
name: Xtream web transport
description: Why LegendStream routes browser Xtream requests through the API artifact.
---

The browser preview must not call user-supplied Xtream servers directly. Hosted preview pages are HTTPS, so direct HTTP providers can be blocked by mixed-content policy, and many providers do not send browser CORS headers. The web client therefore calls the same-origin API proxy, while native Android calls the provider directly.

**Why:** This preserves support for both HTTP and HTTPS provider URLs without exposing browser users to CORS/mixed-content failures, while keeping the native playback path independent of the proxy.

**How to apply:** Keep Xtream credentials in request bodies only, never logs or source. Preserve the proxy error codes/messages when changing provider loading, and keep Android cleartext traffic enabled for HTTP sources.