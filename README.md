# BLIP — Real-World Radar Hide & Seek

<img width="880" height="560" alt="Blip@2x" src="https://github.com/user-attachments/assets/0c790f1f-a171-463f-a6bc-ef2d3052b720" />


# BLIP — Real-World Radar Hide & Seek

**BLIP** is a real-world, GPS-powered multiplayer hide-and-seek web app built for college campuses, neighborhoods, and outdoor play zones. No app store download required—players join via a 4-digit room code in any mobile browser.

🔗 **Live Demo:** [aromalajith8.github.io/Blip](https://aromalajith8.github.io/Blip/)

---

## Core Gameplay & Features

- **Instant 4-Digit Room Lobbies:** Create a match as Host or join from any iOS/Android browser with real-time roster sync.
- **Custom Play Zone Boundaries:** Define a playable radius in meters (e.g., `150m` for a campus courtyard or `300m` for a neighborhood block) with automatic map framing and out-of-bounds alerts.
- **Random Role Assignment:** Shuffles players at match start to assign **1 or 2 Finders** and **Hiders**, followed by a server-synced head-start scatter timer.
- **Periodic Blip Sonar & Map Reveal:**
  - Every set interval (configurable in **seconds** or **minutes**), active Hiders' phones emit a synthesized **2-second sonar alarm** and vibrate.
  - Hosts can toggle **5-second map location reveals** on or off (for pure audio-only hunts).
- **Close-Proximity Radar & `10s → 0s` Capture Lock:**
  - When a Finder closes in, continuous blinking radar beacons appear on both screens.
  - Staying within capture range triggers a live countdown bar (`10s → 0s`) with GPS-drift tolerance and broadcasts a global capture alert to every player in the round.
- **Pocket-Ready Mobile Engineering:**
  - **Screen Wake Lock API** prevents devices from sleeping mid-round.
  - **Web Audio API Synthesizer** generates sonar alarms and capture chimes with zero external audio files.
  - **Solo Test Mode:** Includes a `+ Add Simulated Player` option in the lobby to test countdowns, radar beacons, and captures solo.

---

## Tech Stack

- **Frontend:** HTML5, CSS3 (Minimal Matte Monochrome UI), Vanilla JavaScript
- **Mapping & Geolocation:** [Leaflet.js](https://leafletjs.com/), OpenStreetMap Tiles, Browser Geolocation API, Haversine Distance Formula
- **Backend & Real-Time Sync:** Firebase Realtime Database (`serverTimeOffset` synchronized timers & live coordinate streaming)
- **Device APIs:** Web Audio API, Screen Wake Lock API, Vibration API

---

## How to Play

1. Open **[aromalajith8.github.io/Blip](https://aromalajith8.github.io/Blip/)** in Chrome or Safari on each player's phone.
2. Enter your **Callsign**, then either **Create Match (Host)** or enter a **4-Digit Room Code** to join.
3. Tap **Test 2s Blip Alarm** in the lobby to unlock mobile browser audio and verify volume.
4. Once all players show `GPS OK`, the Host taps **Start Match**.
5. **Hiders** scatter during the head-start countdown; **Finders** hunt using periodic sonar blips and close-range radar locks until time runs out or the capture target is reached.

---

## Running Locally

1. Clone the repository:
   ```bash
   git clone [https://github.com/Aromalajith8/Blip.git](https://github.com/Aromalajith8/Blip.git)
   cd Blip
**BLIP** is a real-world, GPS-powered multiplayer hide-and-seek web app built for college campuses, neighborhoods, and outdoor play zones. No app store download required—players join via a 4-digit room code in any mobile browser.

🔗 **Live Demo:** [aromalajith8.github.io/Blip](https://aromalajith8.github.io/Blip/)

---

## Core Gameplay & Features

- **Instant 4-Digit Room Lobbies:** Create a match as Host or join from any iOS/Android browser with real-time roster sync.
- **Custom Play Zone Boundaries:** Define a playable radius in meters (e.g., `150m` for a campus courtyard or `300m` for a neighborhood block) with automatic map framing and out-of-bounds alerts.
- **Random Role Assignment:** Shuffles players at match start to assign **1 or 2 Finders** and **Hiders**, followed by a server-synced head-start scatter timer.
- **Periodic Blip Sonar & Map Reveal:**
  - Every set interval (configurable in **seconds** or **minutes**), active Hiders' phones emit a synthesized **2-second sonar alarm** and vibrate.
  - Hosts can toggle **5-second map location reveals** on or off (for pure audio-only hunts).
- **Close-Proximity Radar & `10s → 0s` Capture Lock:**
  - When a Finder closes in, continuous blinking radar beacons appear on both screens.
  - Staying within capture range triggers a live countdown bar (`10s → 0s`) with GPS-drift tolerance and broadcasts a global capture alert to every player in the round.
- **Pocket-Ready Mobile Engineering:**
  - **Screen Wake Lock API** prevents devices from sleeping mid-round.
  - **Web Audio API Synthesizer** generates sonar alarms and capture chimes with zero external audio files.
  - **Solo Test Mode:** Includes a `+ Add Simulated Player` option in the lobby to test countdowns, radar beacons, and captures solo.

---

## Tech Stack

- **Frontend:** HTML5, CSS3 (Minimal Matte Monochrome UI), Vanilla JavaScript
- **Mapping & Geolocation:** [Leaflet.js](https://leafletjs.com/), OpenStreetMap Tiles, Browser Geolocation API, Haversine Distance Formula
- **Backend & Real-Time Sync:** Firebase Realtime Database (`serverTimeOffset` synchronized timers & live coordinate streaming)
- **Device APIs:** Web Audio API, Screen Wake Lock API, Vibration API

---

## How to Play

1. Open **[aromalajith8.github.io/Blip](https://aromalajith8.github.io/Blip/)** in Chrome or Safari on each player's phone.
2. Enter your **Callsign**, then either **Create Match (Host)** or enter a **4-Digit Room Code** to join.
3. Tap **Test 2s Blip Alarm** in the lobby to unlock mobile browser audio and verify volume.
4. Once all players show `GPS OK`, the Host taps **Start Match**.
5. **Hiders** scatter during the head-start countdown; **Finders** hunt using periodic sonar blips and close-range radar locks until time runs out or the capture target is reached.

---

## Running Locally

1. Clone the repository:
   ```bash
   git clone [https://github.com/Aromalajith8/Blip.git](https://github.com/Aromalajith8/Blip.git)
   cd Blip
