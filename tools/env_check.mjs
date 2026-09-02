// Diagnose which SQL-access credentials are present. Never prints values.
process.stdout.write(
  `SUPABASE_DB_URL: ${!!process.env.SUPABASE_DB_URL} | DATABASE_URL: ${!!process.env.DATABASE_URL} | SUPABASE_ACCESS_TOKEN: ${!!process.env.SUPABASE_ACCESS_TOKEN}\n`
);