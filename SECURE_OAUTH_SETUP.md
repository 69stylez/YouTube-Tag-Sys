# Secure OAuth Setup (ohne öffentliches client_secret)

Diese App nutzt jetzt einen Token-Proxy. Das `client_secret` liegt nur serverseitig.

## 1) Cloudflare Worker erstellen

Voraussetzung: Cloudflare Account + `wrangler` installiert.

```bash
npm i -g wrangler
wrangler login
cd /Users/stesei/Dev/YouTube-Tag-Sys
wrangler init youtube-tag-token-proxy
```

Ersetze den Worker-Code mit dem Inhalt aus `token-proxy-worker.js`.

## 2) Secrets und Variablen setzen

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

Bei Eingabe jeweils den Wert aus deiner Google OAuth Web Client Konfiguration einfügen.

`ALLOWED_ORIGIN` als normale Variable setzen (in `wrangler.toml`):

```toml
[vars]
ALLOWED_ORIGIN = "https://69stylez.github.io"
```

## 3) Worker deployen

```bash
wrangler deploy
```

Notiere die URL, z. B.:

`https://youtube-tag-token-proxy.<subdomain>.workers.dev/oauth/token`

Wenn du keine Route `/oauth/token` nutzt, kannst du einfach die Root-URL nehmen und in `config.js` eintragen.

## 4) Frontend konfigurieren

In `config.js` setzen:

- `CLIENT_ID` = dein Google OAuth Client ID
- `SHEET_ID` = deine Sheet-ID
- `TOKEN_PROXY_URL` = Worker-URL

Dann commit + push auf GitHub.

## 5) Google Cloud prüfen

OAuth Client (Web):
- Authorized JavaScript origin: `https://69stylez.github.io`
- Authorized redirect URI: `https://69stylez.github.io/YouTube-Tag-Sys/`

## Hinweis

Die Session ist bewusst kurzlebig. Nach Token-Ablauf ist ein neuer Login nötig (sicherer als Refresh Token im Browser).
