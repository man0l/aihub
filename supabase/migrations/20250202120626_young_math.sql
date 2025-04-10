/*
  # Add audio summary fields to documents table

  1. Changes
    - Add `short_summary_audio` column for short form audio summaries
    - Add `long_summary_audio` column for long form audio summaries
    - Remove old `audio_summary_url` column
  
  2. Notes
    - Both new columns are nullable text fields
    - Existing audio summaries will need to be regenerated
*/

-- Add new audio summary columns
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'short_summary_audio'
  ) THEN
    ALTER TABLE documents ADD COLUMN short_summary_audio text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'long_summary_audio'
  ) THEN
    ALTER TABLE documents ADD COLUMN long_summary_audio text;
  END IF;
END $$;

-- Remove old audio_summary_url column if it exists
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'audio_summary_url'
  ) THEN
    ALTER TABLE documents DROP COLUMN audio_summary_url;
  END IF;
END $$;