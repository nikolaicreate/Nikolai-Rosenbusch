# Berlin Drive

Ein Open-World-Fahrspiel im Browser. Man fährt durch ein 3D-Berlin-Mitte, das aus **echten OpenStreetMap-Daten** gebaut wird, mit **Live-Wetter**, **echtem Sonnenstand** und **Live-Verkehr** (optional über TomTom). Die Optik ist filmisch angelegt: ACES-Tonemapping, Bloom, weiche Schatten, nasse Straßen, Nacht mit beleuchteten Fenstern.

> Das Spiel ist ein eigenständiges Projekt. Es lehnt sich nur an den Look moderner Open-World-Spiele an und enthält keine Inhalte, Marken oder Assets anderer Spiele.

## Starten

Es gibt keinen Build-Schritt. Weil ES-Module und `fetch` einen Webserver brauchen, den Ordner einfach statisch ausliefern:

```bash
npx serve .            # oder: python3 -m http.server 8080
```

Dann `http://localhost:3000` (bzw. `:8080`) öffnen und **Losfahren** klicken. Auf GitHub Pages läuft es ebenfalls direkt.

### URL-Parameter (optional)

| Parameter | Werte | Zweck |
|---|---|---|
| `weather` | `live`, `clear`, `cloudy`, `rain`, `storm`, `snow`, `fog` | Wetter erzwingen |
| `time` | `live` oder Stunde, z. B. `21.5` | Tageszeit erzwingen |
| `quality` | `ultra`, `high`, `medium`, `low` | Grafikstufe |
| `autostart` | – | Startbildschirm überspringen |

Beispiel: `?weather=rain&time=22` zeigt Berlin nachts im Regen.

## Steuerung

| Taste | Aktion |
|---|---|
| W / ↑ | Gas |
| S / ↓ | Bremse / Rückwärts |
| A D / ← → | Lenken |
| Leertaste | Handbremse (Drift) |
| C | Kamera wechseln (nah, fern, Cockpit, Kinokamera) |
| M | Vollbildkarte mit Verkehrs-Layer |
| H | Hupe |
| L | Licht an/aus (sonst automatisch) |
| R | Zurück auf die nächste Straße |
| Esc / P | Menü: Wetter, Uhrzeit, Grafik, Lackfarbe, TomTom-Key |

Gamepads (RT/LT/linker Stick/A) und Touch-Tasten auf dem Handy werden ebenfalls unterstützt.

## Woher die Daten kommen

| Bereich | Quelle | Live? |
|---|---|---|
| Gebäude, Straßen, Spree, Parks | OpenStreetMap über die Overpass API, im Browser für 14 Tage zwischengespeichert | Stand der OSM-Datenbank |
| Gebäudehöhen | OSM-Tags `height` / `building:levels`, sonst 15–24 m (Berliner Traufhöhe) | – |
| Wetter | [Open-Meteo](https://open-meteo.com), alle 10 Minuten | ✅ |
| Sonnen- und Mondlicht | astronomisch berechnet für Berlin und die aktuelle Uhrzeit | ✅ |
| Verkehrslage | **mit Key:** TomTom Traffic Flow (8 Messpunkte in Mitte, alle 2 Minuten) · **ohne Key:** Tageszeit-Modell für Berlin | mit Key ✅ |

**Was ehrlich gesagt werden muss:**

- **Live-Verkehr braucht einen API-Key.** Kostenlose, offene Echtzeit-Verkehrsdaten mit Browser-Zugriff gibt es für Berlin nicht. Mit einem kostenlosen Key von [developer.tomtom.com](https://developer.tomtom.com) (im Menü eintragen, er bleibt im Browser) kommen Geschwindigkeit und Staustufe aus echten Messungen. Ohne Key berechnet ein Modell die Dichte aus Wochentag und Uhrzeit, und das HUD zeigt dann **„Modell“** statt **„Live“**.
- **Die einzelnen KI-Autos sind simuliert.** Ihre Anzahl, ihr Tempo und die Farben auf der Karte richten sich nach der Live- bzw. Modell-Verkehrslage. Echte Fahrzeugpositionen sind öffentlich nicht verfügbar.
- **Fahrzeugmodelle** sind eigene, prozedural erzeugte Typen (Limousine, Kompaktwagen, SUV, Transporter, Taxi in Hellelfenbein, BVG-Bus). Lizenzierte Originalmodelle echter Hersteller sind nicht enthalten.
- Ist OpenStreetMap nicht erreichbar, baut das Spiel ein **vereinfachtes Modell von Mitte** mit echten Straßennamen, Spree, Tiergarten und Berliner Blockrandbebauung.

## Aufbau

```
index.html        HUD, Menü, Ladebildschirm, Import-Map (three.js 0.160 über jsDelivr)
style.css
src/main.js       Renderer, Post-Processing, Spielschleife, Kamera, HUD, Eingabe
src/geo.js        Projektion WGS84 → Meter, Overpass-Abfrage, OSM-Parser, Cache
src/fallback.js   Ersatz-Stadt ohne Netz
src/world.js      Gebäude-, Straßen-, Wasser- und Park-Geometrie, Bäume, Laternen,
                  Brandenburger Tor, Fernsehturm, Kollisions- und Straßen-Index
src/cars.js       prozedurale Fahrzeuggeometrie
src/traffic.js    Straßengraph, KI-Fahrzeuge (Folgeverhalten, Kreuzungen), Live-Verkehr
src/weather.js    Open-Meteo, Sonnenstand, Himmel, Wolken, Regen, Schnee, Gewitter
src/player.js     Fahrphysik (Drift, Grip je nach Wetter), Scheinwerfer, Motorsound
src/minimap.js    Radar und Vollbildkarte im Web-Karten-Stil mit Verkehrsfarben
```

## Lizenzen der Daten

- Kartendaten © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende, ODbL
- Wetterdaten: [Open-Meteo.com](https://open-meteo.com), CC BY 4.0
- Verkehrsdaten (optional): © TomTom, laut deren Nutzungsbedingungen
