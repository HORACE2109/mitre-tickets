// Firebase Configuration for Mitre Entradas
const firebaseConfig = {
  projectId: "mitre-entradas",
  appId: "1:732037109386:web:76eb5e66f07966989aff73",
  storageBucket: "mitre-entradas.firebasestorage.app",
  apiKey: "AIzaSyACRc3b9J8hGd6Af6EDd_pXIegdd7Bltvg",
  authDomain: "mitre-entradas.firebaseapp.com",
  messagingSenderId: "732037109386",
  projectNumber: "732037109386"
};

if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
}
