-- Enable the pgmq extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create a queue for video processing
-- First try to create wrapper function if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pgmq_create' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE $FUNC$
    CREATE OR REPLACE FUNCTION public.pgmq_create(
      queue_name TEXT
    )
    RETURNS BOOLEAN
    LANGUAGE SQL
    SECURITY DEFINER
    AS $SQL$
      SELECT pgmq.create(queue_name);
    $SQL$;
    $FUNC$;
  END IF;
END $$;

-- Now create the queue
SELECT pgmq_create('video_processing_queue');

-- Create a table to store video processing metadata
CREATE TABLE IF NOT EXISTS public.video_processing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id text NOT NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued', -- 'queued', 'processing', 'completed', 'error'
  source_url text NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  collection_id uuid REFERENCES public.collections(id) ON DELETE CASCADE,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  transcription_source text, -- 'youtube_api', 's3_whisper', 'fallback'
  s3_video_url text,
  s3_audio_url text
);

-- Enable RLS on video processing table
ALTER TABLE public.video_processing ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to view their own video processing records
CREATE POLICY "Users can view their own video processing records"
  ON public.video_processing
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create policy to allow the service role to update video processing records
CREATE POLICY "Service role can manage all video processing records"
  ON public.video_processing
  USING (auth.jwt() ? 'role' AND auth.jwt()->>'role' = 'service_role'); 