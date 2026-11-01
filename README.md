# Berlin Drive

Ein Open-World-Fahrspiel im Browser. Man fährt durch ein 3D-Berlin-Mitte, das aus **echten OpenStreetMap-Daten** gebaut wird, mit **Live-Wetter**, **echtem Sonnenstand** und **Live-Verkehr** (optional über TomTom). Die Optik ist filmisch angelegt: ACES-Tonemapping, Umgebungsverdeckung (GTAO), Bloom, Color Grading mit Vignette und Filmkorn, weiche Schatten, nasse Straßen, Nacht mit beleuchteten Fenstern und Schaufenstern.

**Ganz Berlin:** Die Stadt wird in Kacheln von 1 × 1 km um dich herum nachgeladen, von Spandau bis Köpenick und von Reinickendorf bis Rudow. Mit Internetzugang kommen Gebäude, Straßen, Gewässer, Parks und Gleise je Kachel aus OpenStreetMap (im Browser 30 Tage zwischengespeichert). Ohne Zugang erzeugt das Spiel ein Modell-Berlin: Altbau-Blöcke in der Innenstadt, Plattenbauten in Marzahn, Hellersdorf, Hohenschönhausen und Gropiusstadt, Einfamilienhäuser am Stadtrand, dazu Tiergarten, Tempelhofer Feld und Grunewald. Der Ortsteil wird beim Überfahren eingeblendet.

**Aussteigen und Fahrzeuge wechseln:** Mit **F** steigst du aus und gehst zu Fuß weiter (Shift: rennen). Dein Auto bleibt geparkt stehen. Mit **F** neben einem Fahrzeug steigst du ein: in dein geparktes Auto, in jedes Auto, Taxi und jeden Bus im Verkehr (der Fahrer steigt aus und überlässt es dir) oder in eine Straßenbahn bzw. S-Bahn, die du dann selbst fährst (W fahren, S bremsen). Busse fahren sich träge, der City EV wendig.

**Leben in der Stadt:**
- **Fußgänger** (bis zu ~480, je nach Grafikstufe und Tageszeit) laufen animiert über die Gehwege, spannen bei Regen Schirme auf und springen beiseite, wenn ein Auto zu nahe kommt.
- **Straßenbahnen** in BVG-Gelb als fünfteilige Gelenkzüge auf echten Gleisen (OSM `railway=tram`), mit Oberleitung, Haltestellenstopps; sie bremsen für dein Auto.
- **S-Bahn-Züge** in Rot-Ocker auf dem gemauerten Stadtbahn-Viadukt (OSM `light_rail`/`rail`, Tunnel ausgenommen).
- **Busse:** BVG-Eindecker und Berliner Doppeldecker im Straßenverkehr.

> Das Spiel ist ein eigenständiges Projekt. Es lehnt sich nur an den Look moderner Open-World-Spiele an und enthält keine Inhalte, Marken oder Assets anderer Spiele.

## Online spielen

**Sofort spielbar:** https://nikolaicreate.github.io/Nikolai-Rosenbusch/
(funktioniert, sobald GitHub Pages einmalig eingeschaltet ist, siehe unten)

### GitHub Pages einschalten (einmalig, ca. 2 Minuten)

1. https://github.com/nikolaicreate/Nikolai-Rosenbusch/settings/pages öffnen (als Repo-Besitzer angemeldet).
2. Unter **Build and deployment → Source** „**Deploy from a branch**“ wählen.
3. Unter **Branch** den Branch `claude/3d-berlin-traffic-game-3z6y5l` wählen, daneben den Ordner **`/ (root)`**, dann **Save**.
4. 1–3 Minuten warten, Seite neu laden. Oben erscheint „Your site is live at …“.
5. Den Link öffnen und **Losfahren** klicken.

### Als App auf dem iPad (oder iPhone/Android)

1. Auf dem iPad **Safari** öffnen und https://nikolaicreate.github.io/Nikolai-Rosenbusch/ aufrufen (GitHub Pages muss eingeschaltet sein, siehe oben).
2. Unten bzw. oben rechts auf das **Teilen-Symbol** tippen (Quadrat mit Pfeil nach oben).
3. **„Zum Home-Bildschirm“** wählen, dann **„Hinzufügen“**.
4. Auf dem Homescreen erscheint **Berlin Drive** mit eigenem Symbol. Antippen: Das Spiel startet im Vollbild wie eine App, mit Touch-Tasten (◀ ▶ lenken, ▲ Gas, ▼ Bremse, ⟲ Handbremse, F ein-/aussteigen, » rennen).

Eine native Unreal-App für das iPad bräuchte einen Mac mit Xcode, Unreal Engine 5 und ein Apple-Entwicklerkonto; sie ist nicht Teil dieses Projekts.

## Lokal starten

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
| `car` | `city`, `vision`, `sport` | Fahrzeug wählen |
| `autostart` | – | Startbildschirm überspringen |

Beispiel: `?weather=rain&time=22` zeigt Berlin nachts im Regen.

## Steuerung

| Taste | Aktion |
|---|---|
| W / ↑ | Gas |
| S / ↓ | Bremse / Rückwärts |
| A D / ← → | Lenken |
| Leertaste | Handbremse (Drift) |
| F / E | Aussteigen bzw. Einsteigen (Auto, Bus, Tram, S-Bahn) |
| Shift | Rennen (zu Fuß) |
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
- **Fahrzeugmodelle** sind eigene, prozedural erzeugte Typen. Spielbar (Menü → Fahrzeug, oder `?car=city|vision|sport`):
  - **City EV:** kleiner Retro-Stromer mit runden LED-Ringscheinwerfern, schwarzem Kontrastdach und weißen Scheibenrädern
  - **Vision:** flache Konzept-Limousine mit schwebendem Flügeldach, durchgehendem Lichtband und Aero-Turbinenfelgen
  - **Coupé:** Sportwagen mit Heckspoiler

  Im Verkehr fahren außerdem Limousinen, Kompaktwagen, SUVs, Transporter, Taxis in Hellelfenbein und BVG-Busse. Die Formen orientieren sich an aktuellem französischem Konzept-Design. Herstellerlogos, Markennamen und lizenzierte Originalmodelle sind bewusst nicht enthalten.
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
src/rail.js       Gleise, Viadukt, Oberleitung, Straßenbahnen und S-Bahn
src/people.js     animierte Fußgänger und Spielfigur
src/walker.js     Spieler zu Fuß
```

## Lizenzen der Daten

- Kartendaten © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende, ODbL
- Wetterdaten: [Open-Meteo.com](https://open-meteo.com), CC BY 4.0
- Verkehrsdaten (optional): © TomTom, laut deren Nutzungsbedingungen
