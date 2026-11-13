// 1. Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyABECV3VWFtqH9zzpsJIPBWWV4EvBHuDyQ",
  authDomain: "blip-game-7a142.firebaseapp.com",
  databaseURL: "https://blip-game-7a142-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "blip-game-7a142",
  storageBucket: "blip-game-7a142.firebasestorage.app",
  messagingSenderId: "906503270744",
  appId: "1:906503270744:web:87b829317c424ac9b2f52d"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// 2. Map & Layers
const map = L.map("map", {
  zoomControl: false,
  minZoom: 13,
  maxZoom: 19
}).setView([11.2588, 75.7804], 16);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
}).addTo(map);

let myMarker = null;
let myAccuracyRing = null;
let myRadiusCircle = null;
let playZoneCircle = null;
let otherMarkers = {};
let autoZoomEnabled = true;
let hasInitialMapFit = false;

map.on("dragstart zoomstart", (e) => {
  if (e.originalEvent) autoZoomEnabled = false;
});

// 3. App State
const myPlayerId = "p_" + Math.random().toString(36).substring(2, 9);
let currentRoomCode = null;
let isHost = false;
let roomRef = null;
let latestRoomData = null;
let serverTimeOffset = 0;

let gpsWatchId = null;
let gameLoopInterval = null;
let myLastCoords = null;
let captureHoldTracker = {};
let lastAlarmCycleTriggered = 0;
let wakeLockSentinel = null;
let audioCtx = null;

db.ref(".info/serverTimeOffset").on("value", (snap) => {
  serverTimeOffset = snap.val() || 0;
});

function getServerNow() {
  return Date.now() + serverTimeOffset;
}

// 4. DOM Elements
const statusText = document.getElementById("status-text");
const screenHome = document.getElementById("screen-home");
const screenLobby = document.getElementById("screen-lobby");
const screenGame = document.getElementById("screen-game");
const screenGameOver = document.getElementById("screen-gameover");

const playerNameInput = document.getElementById("player-name");
const roomCodeInput = document.getElementById("room-code-input");
const homeError = document.getElementById("home-error");

const lobbyRoomCode = document.getElementById("lobby-room-code");
const playerListEl = document.getElementById("player-list");
const playerCountEl = document.getElementById("player-count");
const roleBadge = document.getElementById("role-badge");
const startGameBtn = document.getElementById("start-game-btn");
const addBotBtn = document.getElementById("add-bot-btn");
const lobbyStatus = document.getElementById("lobby-status");

const hudRole = document.getElementById("hud-role");
const hudPhaseLabel = document.getElementById("hud-phase-label");
const hudTimer = document.getElementById("hud-timer");
const hudScore = document.getElementById("hud-score");
const hudSubstatus = document.getElementById("hud-substatus");
const blipBanner = document.getElementById("blip-banner");
const blipBannerText = document.getElementById("blip-banner-text");
const oobBanner = document.getElementById("oob-banner");

const finderWaitOverlay = document.getElementById("finder-wait-overlay");
const lockoutCountdown = document.getElementById("lockout-countdown");
const caughtOverlay = document.getElementById("caught-overlay");

const capturePanel = document.getElementById("capture-panel");
const captureTargetName = document.getElementById("capture-target-name");
const captureTimerText = document.getElementById("capture-timer-text");
const captureBarFill = document.getElementById("capture-bar-fill");

const settingInputs = {
  finderCount: document.getElementById("set-finders"),
  zoneRadiusMeters: document.getElementById("set-zone"),
  headStartSec: document.getElementById("set-headstart"),
  matchDurationMin: document.getElementById("set-duration"),
  captureRadiusMeters: document.getElementById("set-radius"),
  captureHoldSec: document.getElementById("set-hold"),
  alarmIntervalVal: document.getElementById("set-alarm-val"),
  alarmIntervalUnit: document.getElementById("set-alarm-unit"),
  blipMapReveal: document.getElementById("set-blip-map"),
  targetCaptures: document.getElementById("set-target")
};

// 5. Server Connection Indicator
db.ref(".info/connected").on("value", (snap) => {
  if (snap.val() === true) {
    statusText.textContent = "ONLINE";
    statusText.style.color = "#e5e5e5";
  } else {
    statusText.textContent = "CONNECTING...";
    statusText.style.color = "#666666";
  }
});

// 6. Screen Wake Lock
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLockSentinel) {
      wakeLockSentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinel.addEventListener("release", () => {
        wakeLockSentinel = null;
      });
    }
  } catch (_) {}
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && latestRoomData?.status === "playing") {
    requestWakeLock();
  }
});

// 7. Web Audio 2-Second Alarm (Always Rings on Blip)
function unlockAndPlayTwoSecondAlarm() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx) audioCtx = new AudioContextClass();
  if (audioCtx.state === "suspended") audioCtx.resume();

  const now = audioCtx.currentTime;
  for (let i = 0; i < 4; i++) {
    const startTime = now + i * 0.5;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1180, startTime);
    osc.frequency.exponentialRampToValueAtTime(880, startTime + 0.25);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.85, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.28);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(startTime);
    osc.stop(startTime + 0.3);
  }

  if ("vibrate" in navigator) {
    navigator.vibrate([300, 200, 300, 200, 300, 200, 300]);
  }
}

// 8. Create Room (Host)
document.getElementById("create-room-btn").addEventListener("click", async () => {
  const name = playerNameInput.value.trim().toUpperCase();
  if (!name) {
    homeError.textContent = "ENTER YOUR CALLSIGN FIRST.";
    return;
  }

  homeError.textContent = "CREATING ROOM...";
  unlockAndPlayTwoSecondAlarm();

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  isHost = true;
  currentRoomCode = code;
  roomRef = db.ref(`rooms/${code}`);

  await roomRef.set({
    hostId: myPlayerId,
    status: "lobby",
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    settings: {
      finderCount: 1,
      zoneRadiusMeters: 150,
      headStartSec: 40,
      matchDurationMin: 10,
      captureRadiusMeters: 12,
      captureHoldSec: 10,
      alarmIntervalVal: 2,
      alarmIntervalUnit: "min",
      blipMapReveal: "on",
      targetCaptures: 1
    },
    players: {
      [myPlayerId]: {
        name: name,
        role: "unassigned",
        status: "ready",
        audioReady: true
      }
    }
  });

  roomRef.child(`players/${myPlayerId}`).onDisconnect().remove();
  enterLobby(code);
});

// 9. Join Room
document.getElementById("join-room-btn").addEventListener("click", async () => {
  const name = playerNameInput.value.trim().toUpperCase();
  const code = roomCodeInput.value.trim();

  if (!name) {
    homeError.textContent = "ENTER YOUR CALLSIGN FIRST.";
    return;
  }
  if (!/^\d{4}$/.test(code)) {
    homeError.textContent = "ENTER A VALID 4-DIGIT CODE.";
    return;
  }

  homeError.textContent = "JOINING...";
  unlockAndPlayTwoSecondAlarm();

  const targetRef = db.ref(`rooms/${code}`);
  const snap = await targetRef.once("value");

  if (!snap.exists()) {
    homeError.textContent = "ROOM NOT FOUND.";
    return;
  }
  if (snap.val().status !== "lobby") {
    homeError.textContent = "MATCH ALREADY IN PROGRESS.";
    return;
  }

  isHost = snap.val().hostId === myPlayerId;
  currentRoomCode = code;
  roomRef = targetRef;

  await roomRef.child(`players/${myPlayerId}`).set({
    name: name,
    role: "unassigned",
    status: "ready",
    audioReady: true
  });
  roomRef.child(`players/${myPlayerId}`).onDisconnect().remove();
  enterLobby(code);
});

// 10. Enter Lobby & Start GPS Early
function enterLobby(code) {
  homeError.textContent = "";
  showScreen("lobby");
  lobbyRoomCode.textContent = code;
  startGpsStreaming();

  Object.values(settingInputs).forEach((el) => (el.disabled = !isHost));
  if (isHost) {
    roleBadge.textContent = "HOST";
    startGameBtn.classList.remove("hidden");
    addBotBtn.classList.remove("hidden");
  } else {
    roleBadge.textContent = "PLAYER";
    startGameBtn.classList.add("hidden");
    addBotBtn.classList.add("hidden");
  }

  roomRef.off();
  roomRef.on("value", (snap) => {
    const room = snap.val();
    if (!room) return;
    latestRoomData = room;

    const players = room.players || {};
    const playerIds = Object.keys(players);

    playerCountEl.textContent = playerIds.length;
    playerListEl.innerHTML = "";
    playerIds.forEach((pid) => {
      const p = players[pid];
      const li = document.createElement("li");
      const gpsTag = typeof p.lat === "number" ? "GPS OK" : "LOCATING";
      const tag = pid === room.hostId ? `HOST · ${gpsTag}` : (p.isBot ? "SIM BOT" : gpsTag);
      li.innerHTML = `<span>${p.name}</span><span class="player-meta">${tag}</span>`;
      playerListEl.appendChild(li);
    });

    if (room.settings && !isHost) {
      Object.entries(settingInputs).forEach(([k, el]) => {
        if (room.settings[k] !== undefined) el.value = room.settings[k];
      });
    }

    if (room.status === "lobby") {
      stopActiveMatchLoops();
      showScreen("lobby");
    } else if (room.status === "playing") {
      if (screenGame.classList.contains("hidden")) {
        startActiveMatch();
      }
      updateInGameState(room);
    } else if (room.status === "ended") {
      stopActiveMatchLoops();
      renderGameOver(room);
    }
  });
}

function showScreen(name) {
  screenHome.classList.add("hidden");
  screenLobby.classList.add("hidden");
  screenGame.classList.add("hidden");
  screenGameOver.classList.add("hidden");

  if (name === "home") screenHome.classList.remove("hidden");
  if (name === "lobby") screenLobby.classList.remove("hidden");
  if (name === "game") {
    screenGame.classList.remove("hidden");
    setTimeout(() => map.invalidateSize(), 60);
  }
  if (name === "gameover") screenGameOver.classList.remove("hidden");
}

// Host Setting Sync (Supports both numbers and string options)
Object.entries(settingInputs).forEach(([key, inputEl]) => {
  inputEl.addEventListener("change", () => {
    if (!isHost || !roomRef) return;
    if (inputEl.type === "number") {
      const minVal = inputEl.min !== "" ? Number(inputEl.min) : 0;
      const val = Math.max(minVal, Number(inputEl.value));
      inputEl.value = val;
      roomRef.child(`settings/${key}`).set(val);
    } else {
      roomRef.child(`settings/${key}`).set(inputEl.value);
    }
  });
});

// Add Simulated Test Bot inside the Play Zone
addBotBtn.addEventListener("click", async () => {
  if (!isHost || !roomRef) return;
  const botId = "bot_" + Math.floor(100 + Math.random() * 900);
  const offsetLat = (Math.random() - 0.5) * 0.00045;
  const offsetLng = (Math.random() - 0.5) * 0.00045;
  const baseLat = (myLastCoords ? myLastCoords.lat : 11.2588) + offsetLat;
  const baseLng = (myLastCoords ? myLastCoords.lng : 75.7804) + offsetLng;

  await roomRef.child(`players/${botId}`).set({
    name: `BOT-${botId.slice(-3)}`,
    role: "unassigned",
    status: "ready",
    isBot: true,
    lat: baseLat,
    lng: baseLng
  });
});

// Lobby Buttons
document.getElementById("copy-code-btn").addEventListener("click", () => {
  navigator.clipboard.writeText(currentRoomCode);
  const btn = document.getElementById("copy-code-btn");
  btn.textContent = "COPIED";
  setTimeout(() => (btn.textContent = "COPY"), 1500);
});

document.getElementById("test-audio-btn").addEventListener("click", () => {
  unlockAndPlayTwoSecondAlarm();
  lobbyStatus.textContent = "2-SECOND BLIP ALARM TESTED ✅";
  lobbyStatus.style.color = "#e5e5e5";
});

document.getElementById("leave-room-btn").addEventListener("click", () => {
  stopActiveMatchLoops();
  stopGpsStreaming();
  if (roomRef) {
    roomRef.child(`players/${myPlayerId}`).remove();
    roomRef.off();
  }
  currentRoomCode = null;
  isHost = false;
  showScreen("home");
});

// 11. Host Starts Match & Locks Play Zone Center
startGameBtn.addEventListener("click", async () => {
  if (!isHost || !roomRef) return;
  const snap = await roomRef.once("value");
  const room = snap.val();
  const players = room.players || {};
  const playerIds = Object.keys(players);
  const finderCount = Number(room.settings.finderCount || 1);

  if (playerIds.length < finderCount + 1) {
    lobbyStatus.textContent = `NEED AT LEAST ${finderCount + 1} PLAYERS TO START.`;
    lobbyStatus.style.color = "#ff5c5c";
    return;
  }

  // Pick Play Zone Center from Host GPS (or first player with valid GPS)
  let zoneCenter = myLastCoords ? { lat: myLastCoords.lat, lng: myLastCoords.lng } : null;
  if (!zoneCenter) {
    for (const pid of playerIds) {
      if (typeof players[pid].lat === "number" && typeof players[pid].lng === "number") {
        zoneCenter = { lat: players[pid].lat, lng: players[pid].lng };
        break;
      }
    }
  }

  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const finderSet = new Set(shuffled.slice(0, finderCount));
  const updatedPlayers = {};

  playerIds.forEach((pid) => {
    updatedPlayers[pid] = {
      ...players[pid],
      role: finderSet.has(pid) ? "finder" : "hider",
      status: "active",
      outOfBounds: false
    };
  });

  await roomRef.update({
    status: "playing",
    startTime: firebase.database.ServerValue.TIMESTAMP,
    zoneCenter: zoneCenter,
    winner: null,
    winReason: null,
    players: updatedPlayers
  });
});

// 12. Active Match Engine
function startActiveMatch() {
  showScreen("game");
  requestWakeLock();
  captureHoldTracker = {};
  lastAlarmCycleTriggered = 0;
  autoZoomEnabled = true;
  hasInitialMapFit = false;

  startGpsStreaming();
  renderPlayZoneBoundary(latestRoomData);
  fitMapToPlayingArea(latestRoomData, true);

  if (gameLoopInterval) clearInterval(gameLoopInterval);
  gameLoopInterval = setInterval(runMatchTick, 500);
}

function stopActiveMatchLoops() {
  if (gameLoopInterval) {
    clearInterval(gameLoopInterval);
    gameLoopInterval = null;
  }
  clearOtherMarkers();
  if (playZoneCircle) {
    map.removeLayer(playZoneCircle);
    playZoneCircle = null;
  }
  finderWaitOverlay.classList.add("hidden");
  caughtOverlay.classList.add("hidden");
  capturePanel.classList.add("hidden");
  oobBanner.classList.add("hidden");
}

function stopGpsStreaming() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
}

function startGpsStreaming() {
  if (gpsWatchId !== null) return;
  if (!("geolocation" in navigator)) {
    hudSubstatus.textContent = "GPS NOT SUPPORTED";
    return;
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = Math.round(pos.coords.accuracy);
      myLastCoords = { lat, lng, accuracy };

      statusText.textContent = `GPS ±${accuracy}M`;
      hudSubstatus.textContent = `YOU · GPS ±${accuracy}M`;

      updateMyMapMarker(lat, lng, accuracy);

      if (roomRef) {
        roomRef.child(`players/${myPlayerId}`).update({
          lat: lat,
          lng: lng,
          accuracy: accuracy,
          lastSeen: getServerNow()
        });
      }
    },
    (err) => {
      hudSubstatus.textContent = `GPS ERROR: ${err.message.toUpperCase()}`;
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

function renderPlayZoneBoundary(room) {
  const zoneRadius = Number(room?.settings?.zoneRadiusMeters || 0);
  const center = room?.zoneCenter;

  if (zoneRadius > 0 && center && typeof center.lat === "number") {
    if (!playZoneCircle) {
      playZoneCircle = L.circle([center.lat, center.lng], {
        radius: zoneRadius,
        color: "#666666",
        weight: 2,
        dashArray: "8 6",
        fillColor: "#ffffff",
        fillOpacity: 0.02
      }).addTo(map);
    } else {
      playZoneCircle.setLatLng([center.lat, center.lng]);
      playZoneCircle.setRadius(zoneRadius);
    }
  } else if (playZoneCircle) {
    map.removeLayer(playZoneCircle);
    playZoneCircle = null;
  }
}

function updateMyMapMarker(lat, lng, accuracy) {
  const me = latestRoomData?.players?.[myPlayerId];
  const labelText = me ? `YOU (${me.name})` : "YOU";

  if (!myMarker) {
    myAccuracyRing = L.circle([lat, lng], {
      radius: Math.min(accuracy, 25),
      color: "#888888",
      weight: 1,
      fillColor: "#ffffff",
      fillOpacity: 0.06
    }).addTo(map);

    myMarker = L.circleMarker([lat, lng], {
      radius: 9,
      color: "#000000",
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 1
    })
      .bindTooltip(labelText, { permanent: true, direction: "top", offset: [0, -10], className: "blip-tooltip" })
      .addTo(map);
  } else {
    myMarker.setLatLng([lat, lng]);
    myMarker.setTooltipContent(labelText);
    if (myAccuracyRing) {
      myAccuracyRing.setLatLng([lat, lng]);
      myAccuracyRing.setRadius(Math.min(accuracy, 25));
    }
  }

  const radius = Number(latestRoomData?.settings?.captureRadiusMeters || 12);
  if (me && me.role === "finder") {
    if (!myRadiusCircle) {
      myRadiusCircle = L.circle([lat, lng], {
        radius: radius,
        color: "#ffffff",
        weight: 1.5,
        dashArray: "4 4",
        fillColor: "#ffffff",
        fillOpacity: 0.08
      }).addTo(map);
    } else {
      myRadiusCircle.setLatLng([lat, lng]);
      myRadiusCircle.setRadius(radius);
    }
  } else if (myRadiusCircle) {
    map.removeLayer(myRadiusCircle);
    myRadiusCircle = null;
  }

  if (!hasInitialMapFit) {
    fitMapToPlayingArea(latestRoomData, true);
  }
}

// Auto-Zooms Minimally to Frame the Play Zone Boundary (or Active Players)
function fitMapToPlayingArea(room, force = false) {
  if (!room || (!autoZoomEnabled && !force)) return;

  renderPlayZoneBoundary(room);
  hasInitialMapFit = true;

  if (playZoneCircle) {
    map.fitBounds(playZoneCircle.getBounds(), {
      padding: [36, 36],
      maxZoom: 18,
      animate: true
    });
    return;
  }

  const points = [];
  if (myLastCoords) points.push([myLastCoords.lat, myLastCoords.lng]);
  Object.entries(room.players || {}).forEach(([pid, p]) => {
    if (pid !== myPlayerId && typeof p.lat === "number" && typeof p.lng === "number") {
      points.push([p.lat, p.lng]);
    }
  });

  if (points.length === 1) {
    map.setView(points[0], 17, { animate: true });
  } else if (points.length > 1) {
    map.fitBounds(L.latLngBounds(points), { padding: [70, 70], minZoom: 15, maxZoom: 18, animate: true });
  }
}

function updateInGameState(room) {
  const me = room.players?.[myPlayerId];
  if (!me) return;

  hudRole.textContent = me.role.toUpperCase();
  renderPlayZoneBoundary(room);
  if (myLastCoords) {
    updateMyMapMarker(myLastCoords.lat, myLastCoords.lng, myLastCoords.accuracy);
  }

  const allPlayers = Object.values(room.players || {});
  const caughtCount = allPlayers.filter((p) => p.role === "hider" && p.status === "caught").length;
  const target = Number(room.settings?.targetCaptures || 1);
  hudScore.textContent = `${caughtCount} / ${target}`;

  if (me.role === "hider" && me.status === "caught") {
    caughtOverlay.classList.remove("hidden");
  } else {
    caughtOverlay.classList.add("hidden");
  }
}

function clearOtherMarkers() {
  Object.values(otherMarkers).forEach((m) => map.removeLayer(m));
  otherMarkers = {};
}

function syncRadarMarkers(room, shouldRevealHidersOnMap) {
  const players = room.players || {};
  const me = players[myPlayerId];
  if (!me) return;

  const visibleIds = new Set();

  Object.entries(players).forEach(([pid, p]) => {
    if (pid === myPlayerId) return;
    if (typeof p.lat !== "number" || typeof p.lng !== "number") return;

    let shouldShow = false;
    let label = p.name;

    if (me.role === "finder") {
      if (p.role === "finder") {
        shouldShow = true;
        label = `${p.name} (FINDER)`;
      } else if (p.role === "hider" && p.status === "active" && (shouldRevealHidersOnMap || p.outOfBounds)) {
        shouldShow = true;
        label = p.outOfBounds ? `OOB: ${p.name}` : `BLIP: ${p.name}`;
      }
    }

    if (shouldShow) {
      visibleIds.add(pid);
      if (!otherMarkers[pid]) {
        otherMarkers[pid] = L.circleMarker([p.lat, p.lng], {
          radius: 9,
          color: "#ffffff",
          weight: 2,
          fillColor: p.role === "finder" ? "#888888" : "#ffffff",
          fillOpacity: 0.9
        })
          .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -10], className: "blip-tooltip" })
          .addTo(map);
      } else {
        otherMarkers[pid].setLatLng([p.lat, p.lng]);
        otherMarkers[pid].setTooltipContent(label);
      }
    }
  });

  Object.keys(otherMarkers).forEach((pid) => {
    if (!visibleIds.has(pid)) {
      map.removeLayer(otherMarkers[pid]);
      delete otherMarkers[pid];
    }
  });
}

function getAlarmIntervalSeconds(settings) {
  const rawVal = Math.max(1, Number(settings.alarmIntervalVal || 2));
  const unit = settings.alarmIntervalUnit || "min";
  const totalSec = unit === "sec" ? rawVal : rawVal * 60;
  return Math.max(10, totalSec); // Minimum 10s safety floor
}

function runMatchTick() {
  const room = latestRoomData;
  if (!room || room.status !== "playing" || !room.startTime) return;

  const settings = room.settings;
  const players = room.players || {};
  const me = players[myPlayerId];
  if (!me) return;

  // Check Play Zone Boundary for Active Hiders
  const zoneRadius = Number(settings.zoneRadiusMeters || 0);
  if (zoneRadius > 0 && room.zoneCenter && myLastCoords && me.role === "hider" && me.status === "active") {
    const distFromCenter = getDistanceMeters(
      room.zoneCenter.lat,
      room.zoneCenter.lng,
      myLastCoords.lat,
      myLastCoords.lng
    );
    const isOut = distFromCenter > zoneRadius;
    if (isOut) {
      oobBanner.classList.remove("hidden");
      oobBanner.textContent = `OUT OF PLAY ZONE (${Math.round(distFromCenter)}M / ${zoneRadius}M) — RETURN NOW`;
    } else {
      oobBanner.classList.add("hidden");
    }
    if (Boolean(me.outOfBounds) !== isOut && roomRef) {
      roomRef.child(`players/${myPlayerId}/outOfBounds`).set(isOut);
    }
  } else {
    oobBanner.classList.add("hidden");
  }

  const elapsedSec = Math.max(0, (getServerNow() - room.startTime) / 1000);
  const headStartSec = Number(settings.headStartSec || 40);
  const totalMatchSec = Number(settings.matchDurationMin || 10) * 60;
  const alarmIntervalSec = getAlarmIntervalSeconds(settings);
  const mapRevealEnabled = (settings.blipMapReveal || "on") === "on";

  // PHASE A: Head-Start Countdown
  if (elapsedSec < headStartSec) {
    const remainingHeadStart = Math.ceil(headStartSec - elapsedSec);
    hudPhaseLabel.textContent = "HIDE PHASE";
    hudTimer.textContent = formatTime(remainingHeadStart);
    blipBanner.classList.remove("active-ping");
    blipBannerText.textContent = "SCATTER PHASE — STAY INSIDE ZONE";

    if (me.role === "finder") {
      finderWaitOverlay.classList.remove("hidden");
      lockoutCountdown.textContent = remainingHeadStart;
    } else {
      finderWaitOverlay.classList.add("hidden");
      hudSubstatus.textContent = "HIDE NOW BEFORE FINDER RELEASES";
    }
    syncRadarMarkers(room, false);
    return;
  }

  // PHASE B: Active Hunt Countdown
  finderWaitOverlay.classList.add("hidden");
  const huntElapsed = elapsedSec - headStartSec;
  const remainingMatch = Math.max(0, Math.ceil(totalMatchSec - huntElapsed));

  hudPhaseLabel.textContent = "HUNT TIME";
  hudTimer.textContent = formatTime(remainingMatch);

  // Periodic Blip Event (Alarm ALWAYS rings; Map reveal follows Host setting)
  const currentCycle = Math.floor(huntElapsed / alarmIntervalSec);
  const secIntoCycle = huntElapsed % alarmIntervalSec;
  const isBlipWindowActive = currentCycle >= 1 && secIntoCycle < 5;

  if (isBlipWindowActive) {
    const windowLeft = Math.ceil(5 - secIntoCycle);
    blipBanner.classList.add("active-ping");

    if (me.role === "finder") {
      blipBannerText.textContent = mapRevealEnabled
        ? `BLIP DETECTED — HIDERS ON MAP (${windowLeft}S)`
        : `BLIP ALARM RINGING — LISTEN CLOSELY (${windowLeft}S)`;
    } else {
      blipBannerText.textContent = mapRevealEnabled
        ? `BLIP ALARM — SOUND & MAP EXPOSED (${windowLeft}S)`
        : `BLIP ALARM — PHONE RINGING (${windowLeft}S)`;
    }

    // 2-Second Alarm ALWAYS triggers on active Hiders once per cycle
    if (me.role === "hider" && me.status === "active" && lastAlarmCycleTriggered !== currentCycle) {
      lastAlarmCycleTriggered = currentCycle;
      unlockAndPlayTwoSecondAlarm();
    }
  } else {
    blipBanner.classList.remove("active-ping");
    const secUntilNextBlip = Math.ceil(alarmIntervalSec - secIntoCycle);
    blipBannerText.textContent = `NEXT BLIP IN ${formatTime(secUntilNextBlip)}`;
  }

  const shouldRevealHidersOnMap = isBlipWindowActive && mapRevealEnabled;
  syncRadarMarkers(room, shouldRevealHidersOnMap);

  // Check Win Conditions
  if (remainingMatch <= 0) {
    if (isHost) {
      roomRef.update({
        status: "ended",
        winner: "HIDERS WIN",
        winReason: "Time expired before finders reached target captures."
      });
    }
    return;
  }

  const allPlayerEntries = Object.entries(players);
  const activeHiders = allPlayerEntries.filter(([, p]) => p.role === "hider" && p.status === "active");
  const caughtHiders = allPlayerEntries.filter(([, p]) => p.role === "hider" && p.status === "caught");
  const targetCaptures = Number(settings.targetCaptures || 1);

  if (caughtHiders.length >= targetCaptures || activeHiders.length === 0) {
    if (isHost) {
      roomRef.update({
        status: "ended",
        winner: "FINDERS WIN",
        winReason: `Captured ${caughtHiders.length} of ${targetCaptures} required hiders.`
      });
    }
    return;
  }

  // Finder Proximity Capture Check
  if (me.role === "finder" && myLastCoords) {
    const catchRadius = Number(settings.captureRadiusMeters || 12);
    const holdRequired = Number(settings.captureHoldSec || 10);

    let closestHider = null;
    let closestDist = Infinity;

    activeHiders.forEach(([hid, hider]) => {
      if (typeof hider.lat === "number" && typeof hider.lng === "number") {
        const d = getDistanceMeters(myLastCoords.lat, myLastCoords.lng, hider.lat, hider.lng);
        if (d <= catchRadius) {
          captureHoldTracker[hid] = (captureHoldTracker[hid] || 0) + 0.5;
          if (d < closestDist) {
            closestDist = d;
            closestHider = { id: hid, name: hider.name, dist: Math.round(d), held: captureHoldTracker[hid] };
          }

          if (captureHoldTracker[hid] >= holdRequired) {
            captureHoldTracker[hid] = 0;
            roomRef.child(`players/${hid}/status`).set("caught");
            if ("vibrate" in navigator) navigator.vibrate([200, 100, 400]);
          }
        } else {
          captureHoldTracker[hid] = 0;
        }
      }
    });

    if (closestHider) {
      capturePanel.classList.remove("hidden");
      captureTargetName.textContent = `LOCKED: ${closestHider.name} (${closestHider.dist}M)`;
      captureTimerText.textContent = `${closestHider.held.toFixed(1)} / ${holdRequired}S`;
      const pct = Math.min(100, (closestHider.held / holdRequired) * 100);
      captureBarFill.style.width = `${pct}%`;
    } else {
      capturePanel.classList.add("hidden");
      captureBarFill.style.width = "0%";
    }
  }
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// 13. Game Over & Return to Lobby
function renderGameOver(room) {
  showScreen("gameover");
  document.getElementById("winner-title").textContent = room.winner || "MATCH OVER";
  document.getElementById("winner-reason").textContent = room.winReason || "";

  const list = document.getElementById("final-roster-list");
  list.innerHTML = "";
  Object.values(room.players || {}).forEach((p) => {
    const li = document.createElement("li");
    const statusLabel = p.role === "finder" ? "FINDER" : p.status.toUpperCase();
    li.innerHTML = `<span>${p.name}</span><span class="player-meta">${statusLabel}</span>`;
    list.appendChild(li);
  });
}

document.getElementById("back-to-lobby-btn").addEventListener("click", async () => {
  if (isHost && roomRef) {
    const snap = await roomRef.child("players").once("value");
    const players = snap.val() || {};
    const resetPlayers = {};
    Object.entries(players).forEach(([pid, p]) => {
      resetPlayers[pid] = { ...p, role: "unassigned", status: "ready", outOfBounds: false };
    });
    await roomRef.update({
      status: "lobby",
      startTime: null,
      zoneCenter: null,
      winner: null,
      winReason: null,
      players: resetPlayers
    });
  } else {
    showScreen("lobby");
  }
});

document.getElementById("recenter-btn").addEventListener("click", () => {
  autoZoomEnabled = true;
  fitMapToPlayingArea(latestRoomData, true);
});
