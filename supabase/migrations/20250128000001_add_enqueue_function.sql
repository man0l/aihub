-- Create function to enqueue a video processing job
CREATE OR REPLACE FUNCTION public.enqueue_video_processing(
  p_video_id TEXT,
  p_user_id UUID,
  p_source_url TEXT,
  p_collection_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id UUID;
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
  
  -- Add job to queue using the wrapper function in public schema
  PERFORM pgmq_send(
    'video_processing_queue'::TEXT,
    json_build_object(
      'videoId', p_video_id,
      'userId', p_user_id,
      'sourceUrl', p_source_url,
      'jobId', v_job_id,
      'collectionId', p_collection_id
    )::text
  );
  
  RETURN v_job_id;
END;
$$; 