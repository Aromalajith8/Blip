// 1. Your Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyABECV3VWFtqH9zzpsJIPBWWV4EvBHuDyQ",
  authDomain: "blip-game-7a142.firebaseapp.com",
  databaseURL: "https://blip-game-7a142-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "blip-game-7a142",
  storageBucket: "blip-game-7a142.firebasestorage.app",
  messagingSenderId: "906503270744",
  appId: "1:906503270744:web:87b829317c424ac9b2f52d"
};

// 2. Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const statusText = document.getElementById("status-text");
const locateBtn = document.getElementById("locate-btn");

// 3. Initialize Leaflet Map with Key-Free OpenStreetMap Tiles
const map = L.map("map").setView([20.5937, 78.9629], 5);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap",
  maxZoom: 19
}).addTo(map);

let playerMarker = null;

// 4. Test Firebase Connection
db.ref(".info/connected").on("value", (snap) => {
  if (snap.val() === true) {
    statusText.textContent = "ONLINE";
    statusText.style.color = "#e5e5e5";
  } else {
    statusText.textContent = "CONNECTING...";
    statusText.style.color = "#666666";
  }
});

// 5. Start Real-Time GPS Tracking on Button Tap
locateBtn.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    alert("Your browser does not support GPS.");
    return;
  }

  locateBtn.textContent = "ACQUIRING SIGNAL...";

  navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = Math.round(position.coords.accuracy);

      statusText.textContent = `GPS ±${accuracy}M`;
      statusText.style.color = "#ffffff";
      locateBtn.textContent = "SIGNAL LOCKED";

      if (!playerMarker) {
        playerMarker = L.circleMarker([lat, lng], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: "#ffffff",
          fillOpacity: 0.95
        }).addTo(map);
        map.setView([lat, lng], 17);
      } else {
        playerMarker.setLatLng([lat, lng]);
      }

      db.ref("phase1_test").set({
        lat: lat,
        lng: lng,
        accuracy: accuracy,
        updatedAt: Date.now()
      });
    },
    (error) => {
      statusText.textContent = "GPS ERROR";
      statusText.style.color = "#ff5555";
      locateBtn.textContent = "RETRY GPS";
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    }
  );
});
