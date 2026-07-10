-- Fix: Grant all permissions to the database user for all tables
-- Run this as PostgreSQL superuser (postgres)

-- IMPORTANT: Replace 'anandamid' with your actual database user from .env (DB_USER)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "anandamid";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "anandamid";
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "anandamid";

-- Also grant for future tables (so new tables created by migrations are accessible)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "anandamid";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "anandamid";
