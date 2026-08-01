export const environment = {
  production: false,
  // backendUrlNotion: 'http://localhost:3000',
  backendUrlNotion: 'https://notionproxyapi.onrender.com',
  backendUrlMt5: 'https://mt5-api.jakemt5.host',
  // === Supabase config (replaces Notion) ===
  // Get these from: Supabase Dashboard -> Settings -> API
  supabase: {
    url: 'https://jpkvxlzyswookygwcsog.supabase.co',        // TODO: replace with your Project URL
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwa3Z4bHp5c3dvb2t5Z3djc29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MDM0MTQsImV4cCI6MjEwMTA3OTQxNH0.W55IbiS7hSwWq0eaIp7-eWJdQYesp8BdYEQYnMrvo0g'                        // TODO: replace with your anon public key
  },
  firebaseConfig: {
    apiKey: "AIzaSyB5-Z3aLRr-HyopLGF6kXDPR1DdOKoEI_Q",
    authDomain: "tradingdashboard-fce7d.firebaseapp.com",
    projectId: "tradingdashboard-fce7d",
    storageBucket: "tradingdashboard-fce7d.firebasestorage.app",
    messagingSenderId: "714112340582",
    appId: "1:714112340582:web:a2709e6fbc6c9c33ee53a7",
    measurementId: "G-1CZDEEM8R2",
    vapidKey: 'BJpjv9NzUzyZuxu3GSo_D6gjTyD5YnuVdoxEsfvqxXtVzpdd7HIv0Jn7LGnh-8OWaHB4fixHJFg5GyYLxeAcxnE'
  }
};
