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

// 2. Map & Markers
const map = L.map("map").setView([20.5937, 78.9629], 5);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
}).addTo(map);

let myMarker = null;
let myRadiusCircle = null;
let otherMarkers = {}; // Used in Phase 5 for 5-second hider reveal

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
let captureHoldTracker = {}; // { hiderId: secondsHeld }
let audioCtx = null;

// Track Firebase server clock offset so all phones count down in sync
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
const finderWaitOverlay = document.getElementById("finder-wait-overlay");
const lockoutCountdown = document.getElementById("lockout-countdown");
const caughtOverlay = document.getElementById("caught-overlay");

const capturePanel = document.getElementById("capture-panel");
const captureTargetName = document.getElementById("capture-target-name");
const captureTimerText = document.getElementById("capture-timer-text");
const captureBarFill = document.getElementById("capture-bar-fill");

const settingInputs = {
  finderCount: document.getElementById("set-finders"),
  headStartSec: document.getElementById("set-headstart"),
  matchDurationMin: document.getElementById("set-duration"),
  captureRadiusMeters: document.getElementById("set-radius"),
  captureHoldSec: document.getElementById("set-hold"),
  alarmIntervalMin: document.getElementById("set-alarm"),
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

// 6. Web Audio 2-Second Alarm
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

// 7. Create Room (Host)
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
      headStartSec: 40,
      matchDurationMin: 10,
      captureRadiusMeters: 12,
      captureHoldSec: 10,
      alarmIntervalMin: 2,
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

// 8. Join Room
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

// 9. Enter Lobby & Subscribe to Room Changes
function enterLobby(code) {
  homeError.textContent = "";
  showScreen("lobby");
  lobbyRoomCode.textContent = code;

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

    // Update Lobby Roster
    playerCountEl.textContent = playerIds.length;
    playerListEl.innerHTML = "";
    playerIds.forEach((pid) => {
      const p = players[pid];
      const li = document.createElement("li");
      const tag = pid === room.hostId ? "HOST" : (p.isBot ? "SIM BOT" : "READY");
      li.innerHTML = `<span>${p.name}</span><span class="player-meta">${tag}</span>`;
      playerListEl.appendChild(li);
    });

    // Sync Settings for non-host players
    if (room.settings && !isHost) {
      Object.entries(settingInputs).forEach(([k, el]) => {
        if (room.settings[k] !== undefined) el.value = room.settings[k];
      });
    }

    // Handle Match State Transitions
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
  if (name === "game") screenGame.classList.remove("hidden");
  if (name === "gameover") screenGameOver.classList.remove("hidden");
}

// Host Setting Sync
Object.entries(settingInputs).forEach(([key, inputEl]) => {
  inputEl.addEventListener("change", () => {
    if (!isHost || !roomRef) return;
    const val = Math.max(Number(inputEl.min || 1), Number(inputEl.value));
    inputEl.value = val;
    roomRef.child(`settings/${key}`).set(val);
  });
});

// Add Simulated Test Bot (Helpful for solo desk testing)
addBotBtn.addEventListener("click", async () => {
  if (!isHost || !roomRef) return;
  const botId = "bot_" + Math.floor(100 + Math.random() * 900);
  // Places bot slightly offset (~15m) from your current GPS if available
  const baseLat = myLastCoords ? myLastCoords.lat + 0.00012 : 11.2588;
  const baseLng = myLastCoords ? myLastCoords.lng + 0.00012 : 75.7804;

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
  if (roomRef) {
    roomRef.child(`players/${myPlayerId}`).remove();
    roomRef.off();
  }
  currentRoomCode = null;
  isHost = false;
  showScreen("home");
});

// 10. Host Starts Match: Shuffle & Pick 1 or 2 Finders Randomly
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

  // Fisher-Yates shuffle for true random selection
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
      status: "active"
    };
  });

  await roomRef.update({
    status: "playing",
    startTime: firebase.database.ServerValue.TIMESTAMP,
    winner: null,
    winReason: null,
    players: updatedPlayers
  });
});

// 11. Active Match Engine (GPS Streaming + Countdown + Proximity Capture)
function startActiveMatch() {
  showScreen("game");
  captureHoldTracker = {};
  startGpsStreaming();

  if (gameLoopInterval) clearInterval(gameLoopInterval);
  gameLoopInterval = setInterval(runMatchTick, 500);
}

function stopActiveMatchLoops() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  if (gameLoopInterval) {
    clearInterval(gameLoopInterval);
    gameLoopInterval = null;
  }
  finderWaitOverlay.classList.add("hidden");
  caughtOverlay.classList.add("hidden");
  capturePanel.classList.add("hidden");
}

function startGpsStreaming() {
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
      hudSubstatus.textContent = `SIGNAL LOCKED (±${accuracy}M)`;

      // Update my own map dot
      if (!myMarker) {
        myMarker = L.circleMarker([lat, lng], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: "#ffffff",
          fillOpacity: 1
        }).addTo(map);
        map.setView([lat, lng], 18);
      } else {
        myMarker.setLatLng([lat, lng]);
      }

      // Draw capture radius ring if I am a Finder
      const me = latestRoomData?.players?.[myPlayerId];
      const radius = Number(latestRoomData?.settings?.captureRadiusMeters || 12);
      if (me && me.role === "finder") {
        if (!myRadiusCircle) {
          myRadiusCircle = L.circle([lat, lng], {
            radius: radius,
            color: "#ffffff",
            weight: 1,
            dashArray: "4 4",
            fillColor: "#ffffff",
            fillOpacity: 0.08
          }).addTo(map);
        } else {
          myRadiusCircle.setLatLng([lat, lng]);
          myRadiusCircle.setRadius(radius);
        }
      }

      // Push live coordinates to Firebase
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

function updateInGameState(room) {
  const me = room.players?.[myPlayerId];
  if (!me) return;

  hudRole.textContent = me.role.toUpperCase();

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

function runMatchTick() {
  const room = latestRoomData;
  if (!room || room.status !== "playing" || !room.startTime) return;

  const settings = room.settings;
  const players = room.players || {};
  const me = players[myPlayerId];
  if (!me) return;

  const elapsedSec = Math.max(0, (getServerNow() - room.startTime) / 1000);
  const headStartSec = Number(settings.headStartSec || 40);
  const totalMatchSec = Number(settings.matchDurationMin || 10) * 60;

  // PHASE A: Head-Start Countdown
  if (elapsedSec < headStartSec) {
    const remainingHeadStart = Math.ceil(headStartSec - elapsedSec);
    hudPhaseLabel.textContent = "HIDE PHASE";
    hudTimer.textContent = formatTime(remainingHeadStart);

    if (me.role === "finder") {
      finderWaitOverlay.classList.remove("hidden");
      lockoutCountdown.textContent = remainingHeadStart;
    } else {
      finderWaitOverlay.classList.add("hidden");
      hudSubstatus.textContent = "RUN & HIDE BEFORE FINDER RELEASES";
    }
    return;
  }

  // PHASE B: Active Hunt Countdown
  finderWaitOverlay.classList.add("hidden");
  const huntElapsed = elapsedSec - headStartSec;
  const remainingMatch = Math.max(0, Math.ceil(totalMatchSec - huntElapsed));

  hudPhaseLabel.textContent = "HUNT TIME";
  hudTimer.textContent = formatTime(remainingMatch);

  // Check if Time Expired -> Hiders Win
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

  // Check if Target Captures Reached -> Finders Win
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

  // Finder Proximity Capture Check (Every 0.5s tick)
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

          // Capture Complete!
          if (captureHoldTracker[hid] >= holdRequired) {
            captureHoldTracker[hid] = 0;
            roomRef.child(`players/${hid}/status`).set("caught");
            if ("vibrate" in navigator) navigator.vibrate([200, 100, 400]);
          }
        } else {
          // Reset hold timer if Hider escapes outside radius
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

// Haversine Formula: Returns exact distance in meters between two GPS points
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

// 12. Game Over & Return to Lobby
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
      resetPlayers[pid] = { ...p, role: "unassigned", status: "ready" };
    });
    await roomRef.update({
      status: "lobby",
      startTime: null,
      winner: null,
      winReason: null,
      players: resetPlayers
    });
  } else {
    showScreen("lobby");
  }
});

document.getElementById("recenter-btn").addEventListener("click", () => {
  if (myLastCoords) {
    map.setView([myLastCoords.lat, myLastCoords.lng], 18);
  }
});
