import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
  getDatabase,
  ref,
  set,
  get,
  update,
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
export const db = getDatabase(app);

export {
  ref,
  set,
  get,
  update,
  onValue,
  onDisconnect,
  serverTimestamp
};

export async function loginAnonymously() {
  const result = await signInAnonymously(auth);
  return result.user;
}
