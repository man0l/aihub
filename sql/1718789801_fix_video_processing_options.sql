-- Make the options column nullable in video_processing table
ALTER TABLE public.video_processing 
ALTER COLUMN options DROP NOT NULL,
ALTER COLUMN options SET DEFAULT '{}'::jsonb;

-- Update any existing null values to empty JSON objects
UPDATE public.video_processing 
SET options = '{}'::jsonb 
WHERE options IS NULL; 