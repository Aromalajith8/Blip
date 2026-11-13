// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyABECV3VWFtqH9zzpsJIPBWWV4EvBHuDyQ",
  authDomain: "blip-game-7a142.firebaseapp.com",
  databaseURL: "https://console.firebase.google.com/project/blip-game-7a142/database/blip-game-7a142-default-rtdb/data/~2F",
  projectId: "blip-game-7a142",
  storageBucket: "blip-game-7a142.firebasestorage.app",
  messagingSenderId: "906503270744",
  appId: "1:906503270744:web:87b829317c424ac9b2f52d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://PASTE_YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "PASTE_YOUR_PROJECT",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

// 2. Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const statusText = document.getElementById("status-text");
const locateBtn = document.getElementById("locate-btn");

// 3. Initialize Leaflet Map (starts zoomed out until GPS locks)
const map = L.map("map").setView([20.5937, 78.9629], 5);

// Dark-themed free map tiles from CartoDB / OpenStreetMap
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
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

      // Update or create marker on map
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

      // Write test coordinate to Firebase to verify database write permissions
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
      enableHighAccuracy: true, // Forces real GPS chip instead of rough cell-tower estimate
      maximumAge: 0,
      timeout: 10000
    }
  );
});
