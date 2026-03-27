# YouTube Tag Manager — Design Spec

**Datum:** 2026-03-27  
**Autor:** stesei  
**Status:** Approved

## Problemstellung

Beim Veröffentlichen von Videos auf dem YouTube-Kanal des Österreichischen Parlaments müssen bei jedem Upload Keywords/Tags manuell zusammengestellt werden. Es gibt Tags, die fast immer gleich sind, und solche, die sich nach dem Inhalt des Videos richten. Ohne Tool kostet das jedes Mal unnötig Zeit.

## Lösung

Eine statische Web-App, hosted auf GitHub Pages, die eine Google Sheets-Tabelle als Tag-Datenbank nutzt. Der Nutzer öffnet die App im Browser, wählt Tags über Suche/Autocomplete aus, und kopiert das Ergebnis als kommagetrennten String direkt in das YouTube Studio.

---

## Architektur

```
Google Sheets (Datenbank)
        ↕  Google Sheets API v4 (OAuth 2.0 PKCE)
Statische Web-App (GitHub Pages)  ←── Nutzer öffnet im Browser
```

**Keine eigene Backend-Infrastruktur.** Auth und API-Kommunikation laufen vollständig im Browser über OAuth 2.0 mit PKCE-Flow.

---

## Datenmodell (Google Sheets)

### Tab 1: `tags`

| Spalte | Typ | Beschreibung |
|---|---|---|
| `tag` | String | Der Tag-Text (eindeutig) |
| `category` | Enum | `fixed` / `format` / `content` |
| `usage_count` | Integer | Wird inkrementiert wenn „Tags kopieren" geklickt wird |

**Kategorien:**
- `fixed` — Wird bei jeder Session automatisch vorausgewählt (z.B. „Österreichisches Parlament")
- `format` — Sitzungstyp-spezifisch (z.B. „Nationalratssitzung", „Bundesratssitzung")
- `content` — Inhaltlich, videoabhängig (z.B. „Klimaschutz", „Budget")

**Initiale Fixed Tags:**
- Österreichisches Parlament
- Plenarsitzung

**Initiale Format-Tags:**
- Nationalratssitzung
- Bundesratssitzung

### Tab 2: `tag_sets`

| Spalte | Typ | Beschreibung |
|---|---|---|
| `set_name` | String | Name des Tag-Sets |
| `tags` | String | Kommagetrennte Tag-Liste |

**Beispiel-Sets:**
- „Nationalrat Standard" → Österreichisches Parlament, Plenarsitzung, Nationalratssitzung
- „Bundesrat Standard" → Österreichisches Parlament, Plenarsitzung, Bundesratssitzung

---

## UI & Workflow

### Hauptbildschirm: Session Builder

```
┌─────────────────────────────────────────────────────┐
│  🏛️  Parlament Tag Manager                          │
├─────────────────────────────────────────────────────┤
│  Tag-Set laden:  [Nationalrat Standard ▼]  [Laden]  │
├─────────────────────────────────────────────────────┤
│  🔍 Tag suchen oder neu eingeben...                 │
│  ┌───────────────────────────────────────────────┐  │
│  │  Klimaschutz                                  │  │
│  │  Klimapolitik                                 │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  Ausgewählte Tags (14):                             │
│  [🔒 Österreichisches Parlament ×]                  │
│  [🔒 Plenarsitzung ×]                               │
│  [Nationalratssitzung ×]  [Klimaschutz ×]  ...      │
├─────────────────────────────────────────────────────┤
│     [ Als Tag-Set speichern ]  [📋 Tags kopieren]   │
└─────────────────────────────────────────────────────┘
```

### Typischer Workflow

1. App im Browser öffnen (Bookmark)
2. `fixed`-Tags sind automatisch vorausgewählt (`🔒`)
3. Tag-Set laden (z.B. „Nationalrat Standard") — ergänzt Format-Tags
4. Im Suchfeld tippen → Autocomplete aus der Datenbank → Chip klicken zum Hinzufügen
5. Neuer Tag: wird direkt in Sheets gespeichert (mit Duplikat-Warnung)
6. **„📋 Tags kopieren"** → `Österreichisches Parlament, Plenarsitzung, Klimaschutz, ...` im Clipboard
7. In YouTube Studio einfügen — fertig

### Nebenansicht: Tag-Verwaltung

- Alle Tags auflisten, filtern, sortieren
- Tags bearbeiten oder löschen
- Neue Tags hinzufügen (Live-Duplikat-Check)
- Kategorie ändern
- Link zum Google Sheet für direkten Zugriff

---

## Tech Stack

| Schicht | Technologie | Begründung |
|---|---|---|
| Frontend | Vanilla HTML + CSS + JS | Kein Build-Tool, sofort deploybar |
| Autocomplete | Eigene Implementierung | Leichtgewichtig, keine Dependencies |
| API | Google Sheets API v4 | Lesen/Schreiben in das Sheet |
| Auth | Google OAuth 2.0 (PKCE) | Sicher, kein Backend nötig |
| Hosting | GitHub Pages | Kostenlos, geräteunabhängig |

---

## Einmalig-Setup (~20 Minuten)

1. Google Cloud Project erstellen → Sheets API aktivieren → OAuth 2.0 Client ID (Web) erstellen
2. GitHub Repo erstellen → GitHub Pages aktivieren
3. `CLIENT_ID` in `config.js` eintragen
4. Google Sheet erstellen (2 Tabs: `tags`, `tag_sets`) → `SHEET_ID` in `config.js` eintragen
5. App aufrufen → OAuth-Consent einmalig bestätigen → Bookmark setzen

---

## Out of Scope (YAGNI)

- ❌ Tag-History / Versionierung
- ❌ Multi-User / Kollaboration
- ❌ Browser Extension für YouTube Studio
- ❌ KI-basierte Tag-Vorschläge
- ❌ Titel / Beschreibungs-Generierung (anderer Scope)

---

## Verifikationsplan

### Manuell
- [ ] OAuth-Flow funktioniert (Login, Token-Refresh)
- [ ] Tags aus Sheets werden geladen und in Autocomplete angezeigt
- [ ] Fixed Tags sind beim Start vorausgewählt
- [ ] Tag-Set laden funktioniert
- [ ] Neuen Tag hinzufügen → erscheint im Sheet
- [ ] Duplikat-Erkennung schlägt an
- [ ] „Tags kopieren" → Clipboard enthält kommagetrennten String
- [ ] App funktioniert auf Mobilgerät (responsive)
