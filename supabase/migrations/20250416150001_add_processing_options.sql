-- Update video processing function to handle processing options
CREATE OR REPLACE FUNCTION public.enqueue_video_processing(
  p_video_id text,
  p_user_id uuid,
  p_source_url text,
  p_collection_id uuid DEFAULT NULL::uuid,
  p_document_id uuid DEFAULT NULL::uuid,
  p_processing_options jsonb DEFAULT NULL::jsonb
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
    status,
    options
  )
  VALUES (
    p_video_id, 
    p_user_id, 
    p_source_url,
    p_collection_id,
    'queued',
    p_processing_options
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
    'processingOptions', p_processing_options,
    -- snake_case for older code
    'video_id', p_video_id,
    'user_id', p_user_id,
    'source_url', p_source_url,
    'job_id', v_job_id,
    'collection_id', p_collection_id,
    'document_id', p_document_id,
    'processing_options', p_processing_options
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
COMMENT ON FUNCTION public.enqueue_video_processing IS 'Enqueues a video for processing and adds it to the video_processing_queue. Accepts document_id to link with existing document and processing_options for customization. Returns the UUID of the job.'; 