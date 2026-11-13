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
let myPlayerName = "PLAYER";
let myAssignedRole = "unassigned";
let currentRoomCode = null;
let isHost = false;
let roomRef = null;
let latestRoomData = null;
let serverTimeOffset = 0;

let gpsWatchId = null;
let gameLoopInterval = null;
let myLastCoords = null;
let captureHoldTracker = {};
let hiderEscapeTracker = {};
let lastAlarmCycleTriggered = 0;
let lastSeenEventId = null;
let eventBannerTimeout = null;
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
const eventBanner = document.getElementById("event-banner");
const eventBannerText = document.getElementById("event-banner-text");
const proximityBanner = document.getElementById("proximity-banner");
const proximityBannerText = document.getElementById("proximity-banner-text");
const oobBanner = document.getElementById("oob-banner");

const finderWaitOverlay = document.getElementById("finder-wait-overlay");
const lockoutCountdown = document.getElementById("lockout-countdown");
const caughtOverlay = document.getElementById("caught-overlay");
const caughtByText = document.getElementById("caught-by-text");

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

// 7. Web Audio 2-Second Alarm & Capture Chime
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

function playCaptureBroadcastChime() {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(660, now);
  osc.frequency.setValueAtTime(990, now + 0.14);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.6, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.4);

  if ("vibrate" in navigator) {
    navigator.vibrate([180, 90, 250]);
  }
}

// 8. Create Room (Host)
document.getElementById("create-room-btn").addEventListener("click", async () => {
  const name = playerNameInput.value.trim().toUpperCase();
  if (!name) {
    homeError.textContent = "ENTER YOUR CALLSIGN FIRST.";
    return;
  }
  if (statusText.textContent !== "ONLINE") {
    homeError.textContent = "CONNECTING TO SERVER — WAIT 2 SECONDS & TRY AGAIN.";
    return;
  }

  myPlayerName = name;
  myAssignedRole = "unassigned";
  homeError.textContent = "CREATING ROOM...";
  try { unlockAndPlayTwoSecondAlarm(); } catch (_) {}

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  isHost = true;
  currentRoomCode = code;
  roomRef = db.ref(`rooms/${code}`);

  try {
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
          name: myPlayerName,
          role: "unassigned",
          status: "ready",
          audioReady: true
        }
      }
    });

    enterLobby(code);
  } catch (err) {
    homeError.textContent = "ERROR: " + err.message.toUpperCase();
  }
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
  if (statusText.textContent !== "ONLINE") {
    homeError.textContent = "CONNECTING TO SERVER — WAIT 2 SECONDS & TRY AGAIN.";
    return;
  }

  myPlayerName = name;
  myAssignedRole = "unassigned";
  homeError.textContent = "JOINING...";
  try { unlockAndPlayTwoSecondAlarm(); } catch (_) {}

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
    name: myPlayerName,
    role: "unassigned",
    status: "ready",
    audioReady: true
  });
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

    // Remember assigned role locally in case of brief network drop
    if (players[myPlayerId]?.role) {
      myAssignedRole = players[myPlayerId].role;
    }

    playerCountEl.textContent = playerIds.length;
    playerListEl.innerHTML = "";
    playerIds.forEach((pid) => {
      const p = players[pid];
      const displayName = p.name || (pid === myPlayerId ? myPlayerName : "PLAYER");
      const li = document.createElement("li");
      const gpsTag = typeof p.lat === "number" ? "GPS OK" : "LOCATING";
      const tag = pid === room.hostId ? `HOST · ${gpsTag}` : (p.isBot ? "SIM BOT" : gpsTag);
      li.innerHTML = `<span>${displayName}</span><span class="player-meta">${tag}</span>`;
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

// Host Setting Sync
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

// Add Simulated Test Bot (~6m away)
addBotBtn.addEventListener("click", async () => {
  if (!isHost || !roomRef) return;
  const botId = "bot_" + Math.floor(100 + Math.random() * 900);
  const offsetLat = (Math.random() - 0.5) * 0.00008;
  const offsetLng = (Math.random() - 0.5) * 0.00008;
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

// 11. Host Starts Match
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

  let zoneCenter = myLastCoords
    ? { lat: myLastCoords.lat, lng: myLastCoords.lng }
    : { lat: 11.2588, lng: 75.7804 };

  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const finderSet = new Set(shuffled.slice(0, finderCount));
  const updatedPlayers = {};

  playerIds.forEach((pid) => {
    const pName = players[pid].name || (pid === myPlayerId ? myPlayerName : "PLAYER");
    updatedPlayers[pid] = {
      ...players[pid],
      name: pName,
      role: finderSet.has(pid) ? "finder" : "hider",
      status: "active",
      caughtBy: null,
      outOfBounds: false
    };
  });

  await roomRef.update({
    status: "playing",
    startTime: firebase.database.ServerValue.TIMESTAMP,
    zoneCenter: zoneCenter,
    lastEvent: null,
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
  hiderEscapeTracker = {};
  lastAlarmCycleTriggered = 0;
  lastSeenEventId = null;
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
  proximityBanner.classList.add("hidden");
  eventBanner.classList.add("hidden");
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
      updateMyMapMarker(lat, lng, accuracy);

      if (roomRef) {
        const existingPlayer = latestRoomData?.players?.[myPlayerId];
        const gpsPayload = {
          name: existingPlayer?.name || myPlayerName,
          lat: lat,
          lng: lng,
          accuracy: accuracy,
          lastSeen: getServerNow()
        };
        if (!existingPlayer?.role && myAssignedRole !== "unassigned") {
          gpsPayload.role = myAssignedRole;
          gpsPayload.status = "active";
        }
        roomRef.child(`players/${myPlayerId}`).update(gpsPayload);
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
  const resolvedName = me?.name || myPlayerName;
  const labelText = `YOU (${resolvedName})`;

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
  const myRole = me?.role || myAssignedRole;
  if (myRole === "finder") {
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

function showGlobalCaptureBanner(text) {
  eventBannerText.textContent = text;
  eventBanner.classList.remove("hidden");
  playCaptureBroadcastChime();

  if (eventBannerTimeout) clearTimeout(eventBannerTimeout);
  eventBannerTimeout = setTimeout(() => {
    eventBanner.classList.add("hidden");
  }, 5500);
}

function updateInGameState(room) {
  const me = room.players?.[myPlayerId];
  if (!me) return;

  const myRole = me.role || myAssignedRole;
  hudRole.textContent = myRole.toUpperCase();
  renderPlayZoneBoundary(room);
  if (myLastCoords) {
    updateMyMapMarker(myLastCoords.lat, myLastCoords.lng, myLastCoords.accuracy);
  }

  const allPlayers = Object.values(room.players || {});
  const caughtCount = allPlayers.filter((p) => p.role === "hider" && p.status === "caught").length;
  const target = Number(room.settings?.targetCaptures || 1);
  hudScore.textContent = `${caughtCount} / ${target}`;

  if (room.lastEvent && room.lastEvent.id && room.lastEvent.id !== lastSeenEventId) {
    lastSeenEventId = room.lastEvent.id;
    showGlobalCaptureBanner(room.lastEvent.text);
  }

  if (myRole === "hider" && me.status === "caught") {
    caughtOverlay.classList.remove("hidden");
    caughtByText.textContent = me.caughtBy
      ? `Intercepted by ${me.caughtBy}. Stay put or return to start while the round finishes.`
      : "Stay put or walk back to the start point while the round finishes.";
  } else {
    caughtOverlay.classList.add("hidden");
  }
}

function clearOtherMarkers() {
  Object.values(otherMarkers).forEach((entry) => map.removeLayer(entry.layer));
  otherMarkers = {};
}

function syncRadarMarkers(room, shouldRevealHidersOnMap, closePlayerIds) {
  const players = room.players || {};
  const me = players[myPlayerId];
  if (!me) return;

  const myRole = me.role || myAssignedRole;
  const visibleIds = new Set();

  Object.entries(players).forEach(([pid, p]) => {
    if (pid === myPlayerId) return;
    if (typeof p.lat !== "number" || typeof p.lng !== "number") return;

    const isClose = closePlayerIds.has(pid);
    const pName = p.name || "PLAYER";
    let shouldShow = false;
    let shouldBlink = false;
    let label = pName;

    if (myRole === "finder") {
      if (p.role === "finder") {
        shouldShow = true;
        label = `${pName} (FINDER)`;
      } else if (p.role === "hider" && p.status === "active") {
        if (isClose) {
          shouldShow = true;
          shouldBlink = true;
          label = `CLOSE: ${pName}`;
        } else if (shouldRevealHidersOnMap || p.outOfBounds) {
          shouldShow = true;
          label = p.outOfBounds ? `OOB: ${pName}` : `BLIP: ${pName}`;
        }
      }
    } else if (myRole === "hider" && me.status === "active") {
      if (p.role === "finder" && isClose) {
        shouldShow = true;
        shouldBlink = true;
        label = `FINDER NEAR: ${pName}`;
      }
    }

    if (shouldShow) {
      visibleIds.add(pid);
      const existing = otherMarkers[pid];

      if (!existing || existing.isBlinking !== shouldBlink) {
        if (existing) map.removeLayer(existing.layer);

        let layer;
        if (shouldBlink) {
          const blinkIcon = L.divIcon({
            className: "blink-beacon-wrapper",
            html: `<div class="blink-beacon"></div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11]
          });
          layer = L.marker([p.lat, p.lng], { icon: blinkIcon });
        } else {
          layer = L.circleMarker([p.lat, p.lng], {
            radius: 9,
            color: "#ffffff",
            weight: 2,
            fillColor: p.role === "finder" ? "#888888" : "#ffffff",
            fillOpacity: 0.9
          });
        }

        layer
          .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -12], className: "blip-tooltip" })
          .addTo(map);

        otherMarkers[pid] = { layer, isBlinking: shouldBlink };
      } else {
        existing.layer.setLatLng([p.lat, p.lng]);
        existing.layer.setTooltipContent(label);
      }
    }
  });

  Object.keys(otherMarkers).forEach((pid) => {
    if (!visibleIds.has(pid)) {
      map.removeLayer(otherMarkers[pid].layer);
      delete otherMarkers[pid];
    }
  });
}

function getAlarmIntervalSeconds(settings) {
  const rawVal = Math.max(1, Number(settings.alarmIntervalVal || 2));
  const unit = settings.alarmIntervalUnit || "min";
  const totalSec = unit === "sec" ? rawVal : rawVal * 60;
  return Math.max(10, totalSec);
}

function runMatchTick() {
  const room = latestRoomData;
  if (!room || room.status !== "playing" || !room.startTime) return;

  const settings = room.settings;
  const players = room.players || {};
  const me = players[myPlayerId];
  if (!me) return;

  const myRole = me.role || myAssignedRole;
  const myResolvedName = me.name || myPlayerName || "FINDER";
  const catchRadius = Number(settings.captureRadiusMeters || 12);
  const holdRequired = Number(settings.captureHoldSec || 10);
  const closeBlinkRadius = Math.max(catchRadius * 1.5, 18);

  const activeMyCoords = myLastCoords || room.zoneCenter;

  // Check Play Zone Boundary for Active Hiders
  const zoneRadius = Number(settings.zoneRadiusMeters || 0);
  if (zoneRadius > 0 && room.zoneCenter && myLastCoords && myRole === "hider" && me.status === "active") {
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
    proximityBanner.classList.add("hidden");
    capturePanel.classList.add("hidden");

    if (myRole === "finder") {
      finderWaitOverlay.classList.remove("hidden");
      lockoutCountdown.textContent = remainingHeadStart;
    } else {
      finderWaitOverlay.classList.add("hidden");
      hudSubstatus.textContent = "HIDE NOW BEFORE FINDER RELEASES";
    }
    syncRadarMarkers(room, false, new Set());
    return;
  }

  // PHASE B: Active Hunt Countdown
  finderWaitOverlay.classList.add("hidden");
  const huntElapsed = elapsedSec - headStartSec;
  const remainingMatch = Math.max(0, Math.ceil(totalMatchSec - huntElapsed));

  hudPhaseLabel.textContent = "HUNT TIME";
  hudTimer.textContent = formatTime(remainingMatch);

  // Periodic Blip Event
  const currentCycle = Math.floor(huntElapsed / alarmIntervalSec);
  const secIntoCycle = huntElapsed % alarmIntervalSec;
  const isBlipWindowActive = currentCycle >= 1 && secIntoCycle < 5;

  if (isBlipWindowActive) {
    const windowLeft = Math.ceil(5 - secIntoCycle);
    blipBanner.classList.add("active-ping");

    if (myRole === "finder") {
      blipBannerText.textContent = mapRevealEnabled
        ? `BLIP DETECTED — HIDERS ON MAP (${windowLeft}S)`
        : `BLIP ALARM RINGING — LISTEN CLOSELY (${windowLeft}S)`;
    } else {
      blipBannerText.textContent = mapRevealEnabled
        ? `BLIP ALARM — SOUND & MAP EXPOSED (${windowLeft}S)`
        : `BLIP ALARM — PHONE RINGING (${windowLeft}S)`;
    }

    if (myRole === "hider" && me.status === "active" && lastAlarmCycleTriggered !== currentCycle) {
      lastAlarmCycleTriggered = currentCycle;
      unlockAndPlayTwoSecondAlarm();
    }
  } else {
    blipBanner.classList.remove("active-ping");
    const secUntilNextBlip = Math.ceil(alarmIntervalSec - secIntoCycle);
    blipBannerText.textContent = `NEXT BLIP IN ${formatTime(secUntilNextBlip)}`;
  }

  const allPlayerEntries = Object.entries(players);
  const activeHiders = allPlayerEntries.filter(([, p]) => p.role === "hider" && p.status === "active");
  const activeFinders = allPlayerEntries.filter(([, p]) => p.role === "finder");
  const caughtHiders = allPlayerEntries.filter(([, p]) => p.role === "hider" && p.status === "caught");
  const targetCaptures = Number(settings.targetCaptures || 1);

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

  const closePlayerIds = new Set();

  // CASE 1: FINDER PROXIMITY BLINK + LIVE DISTANCE + 10s -> 0s CAPTURE COUNTDOWN
  if (myRole === "finder") {
    if (!activeMyCoords) {
      hudSubstatus.textContent = "WAITING FOR YOUR GPS LOCK...";
    } else {
      let lockingHider = null;
      let lockingDist = Infinity;
      let nearestAnyHider = null;
      let nearestAnyDist = Infinity;

      activeHiders.forEach(([hid, hider]) => {
        if (typeof hider.lat === "number" && typeof hider.lng === "number") {
          const hiderName = hider.name || "HIDER";
          const d = getDistanceMeters(activeMyCoords.lat, activeMyCoords.lng, hider.lat, hider.lng);

          if (d < nearestAnyDist) {
            nearestAnyDist = d;
            nearestAnyHider = { name: hiderName, dist: Math.round(d) };
          }

          if (d <= closeBlinkRadius) {
            closePlayerIds.add(hid);
          }

          if (d <= catchRadius) {
            captureHoldTracker[hid] = (captureHoldTracker[hid] || 0) + 0.5;
            if (d < lockingDist) {
              lockingDist = d;
              lockingHider = { id: hid, name: hiderName, dist: Math.round(d), held: captureHoldTracker[hid] };
            }

            if (captureHoldTracker[hid] >= holdRequired) {
              captureHoldTracker[hid] = 0;
              const broadcastMsg = `${hiderName} WAS CAPTURED BY ${myResolvedName}`;
              roomRef.update({
                [`players/${hid}/status`]: "caught",
                [`players/${hid}/caughtBy`]: myResolvedName,
                lastEvent: {
                  id: `${hid}_${Date.now()}`,
                  text: broadcastMsg,
                  ts: getServerNow()
                }
              }).catch((err) => console.error("Capture update failed:", err));
            }
          } else {
            captureHoldTracker[hid] = Math.max(0, (captureHoldTracker[hid] || 0) - 0.5);
          }
        }
      });

      if (nearestAnyHider) {
        hudSubstatus.textContent = `NEAREST: ${nearestAnyHider.name} (${nearestAnyHider.dist}M / ${catchRadius}M)`;
      } else {
        hudSubstatus.textContent = "WAITING FOR HIDER GPS SIGNAL...";
      }

      if (closePlayerIds.size > 0) {
        proximityBanner.classList.remove("hidden");
        proximityBannerText.textContent = `TARGET IN CLOSE RANGE (${closePlayerIds.size}) — RADAR BLINKING`;
      } else {
        proximityBanner.classList.add("hidden");
      }

      if (lockingHider) {
        const countdownLeft = Math.max(0, holdRequired - lockingHider.held);
        const pctRemaining = (countdownLeft / holdRequired) * 100;
        capturePanel.classList.remove("hidden");
        captureTargetName.textContent = `CAPTURING ${lockingHider.name} (${lockingHider.dist}M)`;
        captureTimerText.textContent = `${countdownLeft.toFixed(1)}S`;
        captureBarFill.style.width = `${pctRemaining}%`;
      } else {
        capturePanel.classList.add("hidden");
        captureBarFill.style.width = "100%";
      }
    }
  }

  // CASE 2: HIDER PROXIMITY BLINK + 10s -> 0s DANGER COUNTDOWN
  if (myRole === "hider" && me.status === "active" && activeMyCoords) {
    let closestFinder = null;
    let closestFinderDist = Infinity;

    activeFinders.forEach(([fid, finder]) => {
      if (typeof finder.lat === "number" && typeof finder.lng === "number") {
        const finderName = finder.name || "FINDER";
        const d = getDistanceMeters(activeMyCoords.lat, activeMyCoords.lng, finder.lat, finder.lng);

        if (d <= closeBlinkRadius) {
          closePlayerIds.add(fid);
        }

        if (d <= catchRadius) {
          hiderEscapeTracker[fid] = (hiderEscapeTracker[fid] || 0) + 0.5;
          if (d < closestFinderDist) {
            closestFinderDist = d;
            closestFinder = { name: finderName, dist: Math.round(d), held: hiderEscapeTracker[fid] };
          }
        } else {
          hiderEscapeTracker[fid] = Math.max(0, (hiderEscapeTracker[fid] || 0) - 0.5);
        }
      }
    });

    if (myLastCoords) {
      hudSubstatus.textContent = `STEALTH ACTIVE · GPS ±${myLastCoords.accuracy}M`;
    }

    if (closePlayerIds.size > 0) {
      proximityBanner.classList.remove("hidden");
      proximityBannerText.textContent = `WARNING: FINDER NEARBY — RADAR BLINKING`;
    } else {
      proximityBanner.classList.add("hidden");
    }

    if (closestFinder) {
      const countdownLeft = Math.max(0, holdRequired - closestFinder.held);
      const pctRemaining = (countdownLeft / holdRequired) * 100;
      capturePanel.classList.remove("hidden");
      captureTargetName.textContent = `LOCKED BY ${closestFinder.name} (${closestFinder.dist}M) — RUN!`;
      captureTimerText.textContent = `${countdownLeft.toFixed(1)}S`;
      captureBarFill.style.width = `${pctRemaining}%`;
    } else {
      capturePanel.classList.add("hidden");
      captureBarFill.style.width = "100%";
    }
  } else if (myRole === "hider" && me.status === "caught") {
    proximityBanner.classList.add("hidden");
    capturePanel.classList.add("hidden");
  }

  const shouldRevealHidersOnMap = isBlipWindowActive && mapRevealEnabled;
  syncRadarMarkers(room, shouldRevealHidersOnMap, closePlayerIds);
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
    const pName = p.name || "PLAYER";
    const statusLabel = p.role === "finder" ? "FINDER" : (p.status || "ACTIVE").toUpperCase();
    li.innerHTML = `<span>${pName}</span><span class="player-meta">${statusLabel}</span>`;
    list.appendChild(li);
  });
}

document.getElementById("back-to-lobby-btn").addEventListener("click", async () => {
  if (isHost && roomRef) {
    const snap = await roomRef.child("players").once("value");
    const players = snap.val() || {};
    const resetPlayers = {};
    Object.entries(players).forEach(([pid, p]) => {
      const pName = p.name || (pid === myPlayerId ? myPlayerName : "PLAYER");
      resetPlayers[pid] = { ...p, name: pName, role: "unassigned", status: "ready", caughtBy: null, outOfBounds: false };
    });
    await roomRef.update({
      status: "lobby",
      startTime: null,
      zoneCenter: null,
      lastEvent: null,
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
