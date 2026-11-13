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

// 2. Background Map
const map = L.map("map").setView([20.5937, 78.9629], 5);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
}).addTo(map);

// 3. App State
const myPlayerId = "p_" + Math.random().toString(36).substring(2, 9);
let currentRoomCode = null;
let isHost = false;
let roomRef = null;
let audioCtx = null;

// 4. DOM Elements
const statusText = document.getElementById("status-text");
const screenHome = document.getElementById("screen-home");
const screenLobby = document.getElementById("screen-lobby");
const playerNameInput = document.getElementById("player-name");
const roomCodeInput = document.getElementById("room-code-input");
const homeError = document.getElementById("home-error");

const lobbyRoomCode = document.getElementById("lobby-room-code");
const playerListEl = document.getElementById("player-list");
const playerCountEl = document.getElementById("player-count");
const roleBadge = document.getElementById("role-badge");
const startGameBtn = document.getElementById("start-game-btn");
const lobbyStatus = document.getElementById("lobby-status");

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

// 6. Web Audio Synthesizer: Unlocks Audio & Plays 2-Second Blip Alarm
function unlockAndPlayTwoSecondAlarm() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  // Play 4 sharp 0.25s radar beeps spread across 2.0 seconds
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
  unlockAndPlayTwoSecondAlarm(); // Unlocks audio on first user tap

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  isHost = true;
  currentRoomCode = code;
  roomRef = db.ref(`rooms/${code}`);

  const initialData = {
    hostId: myPlayerId,
    status: "lobby",
    createdAt: Date.now(),
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
        audioReady: true,
        status: "ready"
      }
    }
  };

  await roomRef.set(initialData);
  roomRef.child(`players/${myPlayerId}`).onDisconnect().remove();
  enterLobby(code);
});

// 8. Join Existing Room
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
    audioReady: true,
    status: "ready"
  });
  roomRef.child(`players/${myPlayerId}`).onDisconnect().remove();
  enterLobby(code);
});

// 9. Enter Lobby & Sync Realtime State
function enterLobby(code) {
  homeError.textContent = "";
  screenHome.classList.add("hidden");
  screenLobby.classList.remove("hidden");
  lobbyRoomCode.textContent = code;

  // Enable or disable inputs depending on Host status
  Object.values(settingInputs).forEach((el) => {
    el.disabled = !isHost;
  });

  if (isHost) {
    roleBadge.textContent = "HOST";
    startGameBtn.classList.remove("hidden");
  } else {
    roleBadge.textContent = "PLAYER";
    startGameBtn.classList.add("hidden");
  }

  // Listen to live room updates
  roomRef.on("value", (snap) => {
    const room = snap.val();
    if (!room) return;

    // Render Player List
    const players = room.players || {};
    const playerIds = Object.keys(players);
    playerCountEl.textContent = playerIds.length;
    playerListEl.innerHTML = "";

    playerIds.forEach((pid) => {
      const p = players[pid];
      const li = document.createElement("li");
      const tag = pid === room.hostId ? "HOST" : (p.audioReady ? "AUDIO OK" : "JOINED");
      li.innerHTML = `<span>${p.name}</span><span class="player-meta">${tag}</span>`;
      playerListEl.appendChild(li);
    });

    // Sync Settings UI for non-hosts (or on initial load)
    if (room.settings && !isHost) {
      settingInputs.finderCount.value = room.settings.finderCount;
      settingInputs.headStartSec.value = room.settings.headStartSec;
      settingInputs.matchDurationMin.value = room.settings.matchDurationMin;
      settingInputs.captureRadiusMeters.value = room.settings.captureRadiusMeters;
      settingInputs.captureHoldSec.value = room.settings.captureHoldSec;
      settingInputs.alarmIntervalMin.value = room.settings.alarmIntervalMin;
      settingInputs.targetCaptures.value = room.settings.targetCaptures;
    }

    // Phase 3 preview: alert when host triggers match start
    if (room.status === "starting") {
      lobbyStatus.textContent = "MATCH STARTING — READY FOR PHASE 3!";
      lobbyStatus.style.color = "#ffffff";
    }
  });
}

// 10. Sync Host Setting Changes to Firebase
Object.entries(settingInputs).forEach(([key, inputEl]) => {
  inputEl.addEventListener("change", () => {
    if (!isHost || !roomRef) return;
    const val = Math.max(Number(inputEl.min || 1), Number(inputEl.value));
    inputEl.value = val;
    roomRef.child(`settings/${key}`).set(val);
  });
});

// 11. Lobby Buttons (Copy Code, Test Alarm, Leave, Start)
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
  if (roomRef) {
    roomRef.child(`players/${myPlayerId}/audioReady`).set(true);
  }
});

document.getElementById("leave-room-btn").addEventListener("click", () => {
  if (roomRef) {
    roomRef.child(`players/${myPlayerId}`).remove();
    roomRef.off();
  }
  currentRoomCode = null;
  isHost = false;
  screenLobby.classList.add("hidden");
  screenHome.classList.remove("hidden");
});

startGameBtn.addEventListener("click", async () => {
  if (!isHost || !roomRef) return;
  const snap = await roomRef.child("players").once("value");
  const count = snap.numChildren();
  const findersNeeded = Number(settingInputs.finderCount.value);

  if (count < findersNeeded + 1) {
    lobbyStatus.textContent = `NEED AT LEAST ${findersNeeded + 1} PLAYERS TO START.`;
    lobbyStatus.style.color = "#ff5c5c";
    return;
  }

  await roomRef.child("status").set("starting");
});
