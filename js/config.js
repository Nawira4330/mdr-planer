// Supabase-Projektzugangsdaten.
// Diese Werte findest du in deinem Supabase-Projekt unter
// "Project Settings" -> "API": "Project URL" und "anon public" Key.
//
// Wichtig: Hier gehört NUR der "anon public" Key hinein, niemals der
// "service_role" Key! Der anon-Key ist bewusst dafür gemacht, im
// Browser/Frontend sichtbar zu sein - der eigentliche Schutz kommt über
// die Row-Level-Security-Regeln in supabase/schema.sql (jede*r sieht nur
// eigene Pferde) und den Login.
const SUPABASE_CONFIG = {
  url: 'https://spxkqemomrggjdprdfgr.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNweGtxZW1vbXJnZ2pkcHJkZmdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MTg0OTksImV4cCI6MjA5OTA5NDQ5OX0.ZhdXZ8SiXRY5F5W-SaHtWhO_bsJvDbWzHP6LCibYCQM',
};
