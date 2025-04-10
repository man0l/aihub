-- Create a table to track applied migrations
CREATE TABLE IF NOT EXISTS public._migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  checksum VARCHAR(64) -- To verify file integrity
);

-- Add comment
COMMENT ON TABLE public._migrations IS 'Tracks applied database migrations'; 