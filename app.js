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
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19
}).addTo(map);

let playerMarker = null;

// 4. Test Firebase Connection
db.ref(".info/connected").on("value", (snap) => {
  if (snap.val() === true) {
    statusText.textContent = "Server Connected ✅";
    statusText.style.color = "#00ff9d";
  } else {
    statusText.textContent = "Connecting to server...";
  }
});

// 5. Start Real-Time GPS Tracking on Button Tap
locateBtn.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    alert("Your browser does not support GPS.");
    return;
  }

  locateBtn.textContent = "Locating...";

  navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = Math.round(position.coords.accuracy);

      statusText.textContent = `GPS Locked (±${accuracy}m)`;
      locateBtn.textContent = "Live GPS Active";

      if (!playerMarker) {
        playerMarker = L.circleMarker([lat, lng], {
          radius: 10,
          color: "#00ff9d",
          fillColor: "#00ff9d",
          fillOpacity: 0.8
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
      statusText.textContent = "GPS Error: " + error.message;
      statusText.style.color = "#ff4d4d";
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    }
  );
});
