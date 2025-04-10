-- Fix type handling in PGMQ wrapper functions

-- Update pgmq_receive to better handle parameter types
CREATE OR REPLACE FUNCTION public.pgmq_receive(
  queue_name TEXT,
  visibility_timeout INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Use explicit type casting to ensure proper type handling
  EXECUTE 'SELECT to_jsonb(pgmq.receive($1, $2::int))'
  USING queue_name, visibility_timeout
  INTO result;
  
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in pgmq_receive: %', SQLERRM;
    RETURN NULL;
END;
$$;

-- Update pgmq_delete to better handle parameter types
CREATE OR REPLACE FUNCTION public.pgmq_delete(
  queue_name TEXT,
  message_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  success BOOLEAN;
BEGIN
  -- Use explicit type casting to ensure proper type handling
  EXECUTE 'SELECT pgmq.delete($1, $2::bigint)'
  USING queue_name, message_id
  INTO success;
  
  RETURN success;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in pgmq_delete: %', SQLERRM;
    RETURN FALSE;
END;
$$;

-- Add diagnostic function to check PGMQ status
CREATE OR REPLACE FUNCTION public.check_pgmq_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'extension_exists', EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pgmq'),
    'extension_info', (SELECT to_jsonb(e) FROM pg_extension e WHERE extname = 'pgmq'),
    'video_processing_queue_exists', EXISTS(SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'video_processing_queue'),
    'queue_stats', (SELECT to_jsonb(q) FROM pgmq.list_queues() q WHERE queue_name = 'video_processing_queue')
  ) INTO result;
  
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

-- Update pgmq_send to better handle parameter types
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
BEGIN
  -- Use explicit type casting to ensure proper type handling
  EXECUTE 'SELECT pgmq.send($1, $2::text)'
  USING queue_name, message
  INTO msg_id;
  
  RETURN msg_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in pgmq_send: %', SQLERRM;
    RETURN -1;
END;
$$; 