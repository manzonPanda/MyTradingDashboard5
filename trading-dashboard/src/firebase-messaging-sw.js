// Import Firebase scripts (compat versions)
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Initialize Firebase inside SW
firebase.initializeApp({
  apiKey: "AIzaSyB5-Z3aLRr-HyopLGF6kXDPR1DdOKoEI_Q",
  authDomain: "tradingdashboard-fce7d.firebaseapp.com",
  projectId: "tradingdashboard-fce7d",
  storageBucket: "tradingdashboard-fce7d.appspot.com", // <- fix here too
  messagingSenderId: "714112340582",
  appId: "1:714112340582:web:a2709e6fbc6c9c33ee53a7",
  measurementId: "G-1CZDEEM8R2"
});

// Retrieve messaging instance
const messaging = firebase.messaging();

// Background notification handler
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});



// Background notification handler
// messaging.onBackgroundMessage(function(payload) {
//   console.log("Received background message ", payload);
//   self.registration.showNotification(payload.notification.title, {
//     body: payload.notification.body,
//     icon: '/assets/icons/icon-96x96.png'
//   });
// });