/*
  # Add audio processing support
  
  1. New Columns
    - `audio_url` - Store the URL of the processed audio file
    - `audio_status` - Track audio processing status
    - `audio_error` - Store any audio processing errors
  
  2. Changes
    - Add new columns to documents table
    - Add audio processing status enum
*/

-- Create audio processing status enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audio_processing_status') THEN
    CREATE TYPE audio_processing_status AS ENUM (
      'pending',
      'processing',
      'completed',
      'error'
    );
  END IF;
END $$;

-- Add audio processing columns
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'audio_url'
  ) THEN
    ALTER TABLE documents ADD COLUMN audio_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'audio_status'
  ) THEN
    ALTER TABLE documents ADD COLUMN audio_status audio_processing_status DEFAULT 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'audio_error'
  ) THEN
    ALTER TABLE documents ADD COLUMN audio_error text;
  END IF;
END $$;