export const environment = {
  production: false,
  backendUrlNews: 'https://forexnewsapi.onrender.com',
  backendUrlMt5: 'https://mt5-api.jakemt5.host',
  // Dev builds talk to the LOCAL AURA backend (npm run dev in aura-backend).
  // Production builds use environment.prod.ts (the hosted deployment).
  backendUrlAura: 'http://localhost:5000',
  // === Supabase config (replaces Notion) ===
  supabase: {
    url: 'https://jpkvxlzyswookygwcsog.supabase.co',        // TODO: replace with your Project URL
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwa3Z4bHp5c3dvb2t5Z3djc29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MDM0MTQsImV4cCI6MjEwMTA3OTQxNH0.W55IbiS7hSwWq0eaIp7-eWJdQYesp8BdYEQYnMrvo0g'                        // TODO: replace with your anon public key
  },

};
