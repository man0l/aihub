-- Current Schema Snapshot as of 2025-04-16
-- This file provides a reference of the current database schema
-- DO NOT APPLY THIS MIGRATION - FOR REFERENCE ONLY

-- Note: This is a documentation file showing the current state of the database
-- after all migrations have been applied. It can be used as a reference for
-- future development but should not be executed as a migration.

-----------------------------------------------------------
-- Functions
-----------------------------------------------------------

-- pgmq_send function
CREATE OR REPLACE FUNCTION public.pgmq_send(
  queue_name TEXT,
  message TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  msg_id BIGINT;
  json_message JSONB;
BEGIN
  -- Try to parse as JSON first (in case it's already a JSON string)
  BEGIN
    json_message := message::jsonb;
  EXCEPTION WHEN OTHERS THEN
    -- If it fails, treat as a regular string
    json_message := to_jsonb(message);
  END;
  
  -- Use explicit parameter passing instead of format
  EXECUTE 'SELECT pgmq.send($1, $2)'
  USING queue_name, json_message::text
  INTO msg_id;
  
  RAISE NOTICE 'Enqueued message to %: %', queue_name, msg_id;
  RETURN msg_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in pgmq_send: % - %. Message: %', SQLERRM, SQLSTATE, message;
    RETURN -1;
END;
$$;

-- Video processing function
CREATE OR REPLACE FUNCTION public.enqueue_video_processing(
  p_video_id text,
  p_user_id uuid,
  p_source_url text,
  p_collection_id uuid DEFAULT NULL::uuid,
  p_document_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id UUID;
  v_result BIGINT;
  v_message JSONB;
BEGIN
  -- Insert record into video_processing table
  INSERT INTO public.video_processing (
    video_id, 
    user_id, 
    source_url, 
    collection_id,
    status
  )
  VALUES (
    p_video_id, 
    p_user_id, 
    p_source_url,
    p_collection_id,
    'queued'
  )
  RETURNING id INTO v_job_id;
  
  -- Build the message with both formats for maximum compatibility
  -- Include both camelCase and snake_case keys for backward compatibility
  v_message := jsonb_build_object(
    -- camelCase for newer code
    'videoId', p_video_id,
    'userId', p_user_id,
    'sourceUrl', p_source_url,
    'jobId', v_job_id,
    'collectionId', p_collection_id,
    'documentId', p_document_id,
    -- snake_case for older code
    'video_id', p_video_id,
    'user_id', p_user_id,
    'source_url', p_source_url,
    'job_id', v_job_id,
    'collection_id', p_collection_id,
    'document_id', p_document_id
  );
  
  -- Add job to queue using the wrapper function in public schema
  v_result := pgmq_send(
    'video_processing_queue'::TEXT,
    v_message::text
  );
  
  -- Check if the send was successful
  IF v_result = -1 THEN
    RAISE WARNING 'Failed to enqueue message to video_processing_queue for job %', v_job_id;
  ELSE
    RAISE NOTICE 'Successfully enqueued message % to video_processing_queue for job %', v_result, v_job_id;
  END IF;
  
  RETURN v_job_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Exception in enqueue_video_processing: %', SQLERRM;
    -- Rethrow the exception
    RAISE;
END;
$$;

-- Add comment
COMMENT ON FUNCTION public.enqueue_video_processing IS 'Enqueues a video for processing and adds it to the video_processing_queue. Accepts document_id to link with existing document. Returns the UUID of the job.';

-----------------------------------------------------------
-- Tables Reference (these already exist - DO NOT CREATE)
-----------------------------------------------------------

/*
-- Main tables
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  cover_image text,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  original_content text,
  content_type text NOT NULL, -- 'youtube', 'pdf', 'webpage', etc.
  source_url text,
  transcription text,
  short_summary text,
  long_summary text,
  collection_id uuid REFERENCES collections(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  processing_status text DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'error'
  short_summary_audio text,
  long_summary_audio text,
  audio_url text,
  audio_status audio_processing_status DEFAULT 'pending',
  audio_error text
);

CREATE TABLE topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE document_topics (
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, topic_id)
);

CREATE TABLE video_processing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id text NOT NULL,
  document_id uuid,
  status text NOT NULL DEFAULT 'queued', -- 'queued', 'processing', 'completed', 'error'
  source_url text,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  collection_id uuid REFERENCES collections(id) ON DELETE CASCADE,
  options jsonb DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  transcription_source text,
  s3_video_url text,
  s3_audio_url text
);
*/ 