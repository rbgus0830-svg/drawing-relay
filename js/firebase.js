import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
  getDatabase,
  connectDatabaseEmulator,
  ref,
  set,
  get,
  update,
  runTransaction,
  onValue,
  onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAobskDC4Aghi9dcSCS5WdZg0zklG_5gKs",
  authDomain: "drawing-relay-81ab0.firebaseapp.com",
  databaseURL:
    "https://drawing-relay-81ab0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "drawing-relay-81ab0",
  storageBucket:
    "drawing-relay-81ab0.firebasestorage.app",
  messagingSenderId: "882192977442",
  appId:
    "1:882192977442:web:4e7b7dbd35d1e772a6847b"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
const database = getDatabase(app);

if (
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1"
) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectDatabaseEmulator(database, "127.0.0.1", 9000);

  console.info("[Firebase] Auth 및 Database Emulator에 연결됨");
}

export const db = database;

export {
  ref,
  set,
  get,
  update,
  runTransaction,
  onValue,
  onDisconnect,
  serverTimestamp
};

export async function loginAnonymously() {
  const result = await signInAnonymously(auth);
  return result.user;
}
