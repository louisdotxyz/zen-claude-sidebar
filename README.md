# Claude Sidebar für Zen

Private Claude-Sidebar für Zen (und Firefox). Kein Server dazwischen: Anfragen gehen direkt vom Browser an die Anthropic-API, der Verlauf bleibt lokal im Browser-Profil.

## Funktionen
- **Ein-/Ausblenden**: Toolbar-Button (Stern-Symbol) oder `Alt+Shift+C`.
- **Befehle mit `/`**: `/zusammenfassen`, `/recherche`, `/vergleichen`, `/finden`, `/aufräumen`, `/sortieren`, `/übersicht`, `/erklären`, `/übersetzen`. Eigene Befehle in den Einstellungen (`name: Prompt`).
- **Tabs mit `@`** dazunehmen, oder über „+ Tabs“. Die aktuelle Seite geht über den Chip „Diese Seite“ mit.
- **Recherche**: Claude sucht selbst im Web (abschaltbar) und listet die Quellen.
- **Produktvergleich**: liest die Produkt-Tabs und baut eine Vergleichstabelle; fehlende Angaben sucht es beim Hersteller.
- **Bilder**: reinziehen, einfügen (auch Bild-Links) oder Rechtsklick auf ein Bild → „Produkt finden“. Nur Bild + Enter startet die Produktsuche. Claude erkennt das Produkt am Aussehen und sucht per Text; eine echte Rückwärts-Bildsuche ist es nicht.
- **Rechtsklick auf markierten Text**: Erklären, Übersetzen, Umschreiben, Im Chat fragen.
- **Tabs und Ordner**: lesen, in Ordner sortieren, umbenennen, verschieben. „Aufräumen“ schlägt zusätzlich Duplikate und lange unbenutzte Tabs zum Schliessen vor. Schliessen fragt immer nach; angepinnte Tabs werden nie geschlossen.
- **Einstellungen**: Sprache (Deutsch/English), Aussehen, Hintergrundfarbe (folgt dem Browser-Theme oder eigene Farbe), Standard-Modell und Stufe (Niedrig/Mittel/Hoch). Änderungen speichern sich sofort.
- **Über mich**: Text in den Einstellungen, der bei jeder Anfrage mitgeht.
- **Verlauf**: lokal gespeichert, einzeln oder komplett löschbar. Modell im Chat umschaltbar.

## Installieren
1. Neuestes Release öffnen: https://github.com/louisdotxyz/zen-claude-sidebar/releases/latest
2. Die `.xpi` herunterladen und in Zen in `about:addons` ziehen.

Danach aktualisiert sich die Extension automatisch. Sofort prüfen: `about:addons` → Zahnrad → „Nach Updates suchen“.

## Neue Version veröffentlichen
1. Code ändern und in `manifest.json` die `version` erhöhen.
2. Auf `main` pushen.

Die GitHub Action signiert die Version bei Mozilla (privat, „unlisted“), legt ein Release an und trägt es in `updates.json` ein. Zen findet das Update beim nächsten Check (normalerweise innert eines Tages).

Einmalig nötig: unter *Settings → Secrets and variables → Actions* die Mozilla-API-Schlüssel als `AMO_JWT_ISSUER` und `AMO_JWT_SECRET` hinterlegen (erstellen unter https://addons.mozilla.org/developers/addon/api/key/).

Zum Testen ohne Installation: `about:debugging#/runtime/this-firefox` → „Temporäres Add-on laden…“ → `manifest.json` wählen.

## Datenschutz
- API-Key und Chats liegen in `browser.storage.local` (nur dieses Profil).
- Seiteninhalte gehen nur an Anthropic, und nur wenn du eine Nachricht mit Kontext schickst.
- Seiteninhalte werden für Claude als Daten markiert, nicht als Anweisungen.
- Interne Seiten (about:, Erweiterungs-Seiten, AMO) können Extensions grundsätzlich nicht lesen.

## Bekannte Grenzen
- Zen-Workspaces sind für Extensions nicht direkt sichtbar. Tabs anderer Workspaces erscheinen evtl. als „hidden“; Claude lässt sie in Ruhe, ausser du sagst es ausdrücklich.
- Zen-Ordner basieren auf Firefox-Tab-Gruppen. Falls Zen sie anders umsetzt, sieht Claude die Ordner nicht; dann bitte melden.
- Das Claude-Abo gilt nicht für die API; Abrechnung nach Verbrauch über console.anthropic.com.

## Dateien
- `manifest.json` – Extension-Definition
- `sidebar/panel.*` – Oberfläche und Logik
- `sidebar/i18n.js` – Texte in Deutsch und Englisch
- `sidebar/api.js` – Anthropic-API mit Streaming
- `sidebar/tabs.js` – Seiten auslesen
- `sidebar/tools.js` – Werkzeuge für Tabs und Ordner
- `background.js` – Toolbar-Button und Rechtsklick-Menü
- `updates.json` – Update-Liste für Zen (wird von der Action gepflegt)
- `.github/workflows/release.yml` – automatisches Signieren und Veröffentlichen
- `sidebar/markdown.js` – sicherer Markdown-Renderer
