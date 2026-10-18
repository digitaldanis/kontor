# Kontor

Rechnungen schreiben und Zeiten erfassen – an einem Ort. Kontor ist eine schlanke Web-App für Freelancer und kleine Unternehmen in Deutschland und der EU: Zeiten pro Kunde stoppen, mit einem Klick in eine Rechnung übernehmen, Pflichtangaben prüfen lassen und als PDF oder E-Rechnung exportieren.

Alle Daten bleiben lokal im Browser (IndexedDB). Es gibt keinen Server, kein Konto und kein Tracking.

![Übersicht](docs/screenshots/dashboard.png)

| Rechnungseditor | Zeiterfassung |
| --- | --- |
| ![Editor](docs/screenshots/editor.png) | ![Zeiterfassung](docs/screenshots/time.png) |

| Mobil | Dunkelmodus |
| --- | --- |
| ![Mobil](docs/screenshots/mobile.png) | ![Dunkel](docs/screenshots/dark.png) |

## Funktionen

**Rechnungen**
- Rechnung für einen Kunden oder als Schnellrechnung an einen frei eingetippten Empfänger
- Positionen mit Menge, Einheit, Einzelpreis, Steuersatz und Rabatt pro Position
- Summen in ganzen Cent, Umsatzsteuer je Steuersatz auf die Nettosumme gerundet
- Status: Entwurf, offen, überfällig, bezahlt, storniert
- Fortlaufende, lückenlose Nummern nach eigenem Schema (z. B. `RE-{YYYY}-{0001}`), vergeben erst beim Abschließen
- Abgeschlossene Rechnungen sind unveränderbar; Korrektur nur per Stornorechnung (optional direkt mit korrigierter Kopie)
- Duplizieren, Angebote mit Umwandlung in eine Rechnung
- Drei Layouts (Klassisch, Modern, Minimal) mit Akzentfarbe und Live-Vorschau
- PDF-Export in A4 nach DIN 5008 (Anschriftenfeld Form B, Falz- und Lochmarken), mehrseitig mit Seitenzahlen
- E-Rechnung: ZUGFeRD/Factur-X-PDF mit eingebetteter `factur-x.xml` (Profil EN 16931) oder XRechnung 3.0 als CII-XML – **experimentell**, siehe unten

**Rechtliche Prüfung (§ 14 UStG, Art. 226 MwStSystRL)**
- Prüft im Editor laufend alle Pflichtangaben: Name und Anschrift beider Seiten, Steuernummer oder USt-IdNr., Datum, Nummer, Menge und Art der Leistung, Leistungsdatum bzw. -zeitraum, Entgelt nach Steuersätzen, Steuerbetrag oder Befreiungshinweis
- Sonderfälle: Kleinunternehmer (§ 19 UStG), Reverse Charge innerhalb der EU (USt-IdNr. beider Seiten, Hinweis auf Steuerschuldnerschaft des Leistungsempfängers), innergemeinschaftliche Lieferung, Drittland
- Kleinbetragsrechnungen bis 250 € brutto (§ 33 UStDV)
- Schlägt den Steuerfall anhand von Land und USt-IdNr. des Kunden vor
- Fehler blockieren das Abschließen, Hinweise nicht

**Zeiterfassung**
- Stoppuhr pro Kunde, läuft auch nach dem Neuladen weiter und ist in der Navigation sichtbar
- Manuelle Einträge mit Tätigkeit, Details, Projekt, abrechenbar ja/nein und optionalem Stundensatz
- Offene Zeiten mit einem Klick in eine Rechnung übernehmen – je Eintrag, je Tag oder je Projekt; die Einträge gelten danach als abgerechnet
- Wochen- und Monatsübersicht mit Tagesbalken

**Außerdem**
- Kundenverwaltung mit Suche, Archiv, Stundensatz und Zahlungsziel je Kunde; Kundenseite mit Rechnungen, Zeiten und offenen Beträgen
- Dashboard: Umsatz Monat/Jahr, offene und überfällige Rechnungen, laufende Stoppuhr, Stunden
- Berichte: Umsatz pro Monat, Umsatzsteuer-Übersicht nach Monat oder Quartal, Umsatz und Stunden nach Kunde und Projekt
- Einstellungen: Firmendaten, Logo (PNG/JPG/SVG), Bankverbindung, Standardtexte mit Platzhaltern, Zahlungsziel, Steuersatz, Währung, Nummernkreise, Layout und Farbe
- JSON-Sicherung und Wiederherstellung, CSV-Export der Rechnungen (Excel-kompatibel)
- Onboarding beim ersten Start, optional mit Beispieldaten
- Hell- und Dunkelmodus nach Systemeinstellung, responsiv vom Smartphone bis zum Desktop, per Tastatur bedienbar (`g` gefolgt von `u`, `r`, `k`, `z`, `b` oder `e` springt zwischen den Bereichen)

## Starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm run dev        # Entwicklungsserver auf http://localhost:5173
npm test           # Unit-Tests (Vitest)
npm run build      # Produktionsbuild nach dist/
npm run preview    # Build lokal ansehen
```

Der Build ist eine rein statische Seite (relative Pfade, Hash-Routing) und läuft auf jedem Webspace, z. B. GitHub Pages oder Netlify.

## Technik

- Vite, React 19, TypeScript
- Dexie (IndexedDB) für die lokale Datenhaltung
- pdf-lib für PDF und das Einbetten der E-Rechnung
- Eigenes CSS ohne UI-Framework, Icons von Lucide
- Vitest für Steuer-, Summen-, Nummern- und Ablauf-Tests

```
src/
  lib/          Geschäftslogik: Berechnung, Nummernkreise, Validierung, PDF, E-Rechnung, Datenbank
  components/   wiederverwendbare Oberflächen-Bausteine
  pages/        Seiten (Übersicht, Rechnungen, Kunden, Zeiterfassung, Berichte, Einstellungen)
```

Geldbeträge werden durchgehend als ganze Cent gespeichert und mit BigInt kaufmännisch gerundet.

## E-Rechnung (experimentell)

Kontor erzeugt Rechnungsdaten im UN/CEFACT-CII-Format nach EN 16931, entweder eingebettet in ein PDF (ZUGFeRD 2.x / Factur-X, Profil EN 16931) oder als XRechnung 3.0. Beispielrechnungen für Regelbesteuerung, Reverse Charge, Kleinunternehmer, Drittland und Storno wurden mit dem KoSIT-Validator (Konfiguration XRechnung 3.0.2) ohne Fehler geprüft. Das PDF ist allerdings **kein validiertes PDF/A-3**, und der Export ist nicht offiziell zertifiziert. Prüfe die Dateien vor dem produktiven Einsatz, z. B. mit dem [KoSIT-Validator](https://github.com/itplr-kosit/validator).

## Datensicherung

Die Daten liegen nur in dem Browser, in dem du Kontor nutzt. Lade regelmäßig unter *Einstellungen → Daten* eine Sicherung herunter. Rechnungen müssen in Deutschland in der Regel acht Jahre aufbewahrt werden – bewahre die exportierten PDFs zusätzlich an einem sicheren Ort auf.

## Rechtlicher Hinweis

Kontor hilft dabei, formal vollständige Rechnungen zu schreiben, ersetzt aber keine Steuer- oder Rechtsberatung. Alle Prüfungen und Texte sind nach bestem Wissen erstellt, jedoch ohne Gewähr für Richtigkeit und Vollständigkeit. Ob ein Steuerfall (z. B. Reverse Charge oder Kleinunternehmerregelung) auf dich zutrifft, klärst du am besten mit deiner Steuerberatung. Kontor ist keine zertifizierte GoBD-Software; die Unveränderbarkeit abgeschlossener Rechnungen ist innerhalb der App umgesetzt, aber nicht gegen Eingriffe in die Browser-Datenbank geschützt.

## Lizenz

MIT
