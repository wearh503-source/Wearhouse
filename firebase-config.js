// Firebase Web SDK Configuration for Wearhouse
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  projectId: "wear-house-6d810",
  appId: "1:52294491181:web:2fa3b1d59694a5540b2ca4",
  storageBucket: "wear-house-6d810.firebasestorage.app",
  apiKey: "AIzaSyDaCBap5iVKrF6APAZy81m2X1IieTgB-cM",
  authDomain: "wear-house-6d810.firebaseapp.com",
  messagingSenderId: "52294491181",
  measurementId: "G-0N4KZL3YJ9"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;
const db = getFirestore(app);
const auth = getAuth(app);

export { app, analytics, db, auth, firebaseConfig };
