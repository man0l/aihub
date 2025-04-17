-- Add chapters column to documents table
ALTER TABLE public.documents ADD COLUMN chapters TEXT DEFAULT NULL;
COMMENT ON COLUMN public.documents.chapters IS 'Stores video chapters with timestamps from transcription'; 