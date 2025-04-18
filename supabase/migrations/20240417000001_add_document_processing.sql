-- Drop existing function
DROP FUNCTION IF EXISTS public.enqueue_document_processing(uuid, uuid, text, uuid);

-- Create the document processing queue if it doesn't exist
SELECT pgmq.create_queue('document_processing_queue');

-- Create document processing function
CREATE OR REPLACE FUNCTION public.enqueue_document_processing(
  p_document_id uuid,
  p_user_id uuid,
  p_source_url text,
  p_collection_id uuid DEFAULT NULL::uuid
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
  -- Build the message
  v_message := jsonb_build_object(
    'documentId', p_document_id,
    'userId', p_user_id,
    'sourceUrl', p_source_url,
    'collectionId', p_collection_id,
    'document_id', p_document_id,
    'user_id', p_user_id,
    'source_url', p_source_url,
    'collection_id', p_collection_id
  );
  
  -- Add job to queue using the wrapper function in public schema
  v_result := pgmq_send(
    'document_processing_queue'::TEXT,
    v_message::text
  );
  
  -- Check if the send was successful
  IF v_result = -1 THEN
    RAISE WARNING 'Failed to enqueue message to document_processing_queue for document %', p_document_id;
  ELSE
    RAISE NOTICE 'Successfully enqueued message % to document_processing_queue for document %', v_result, p_document_id;
  END IF;
  
  RETURN p_document_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Exception in enqueue_document_processing: %', SQLERRM;
    -- Rethrow the exception
    RAISE;
END;
$$;

-- Add comment
COMMENT ON FUNCTION public.enqueue_document_processing IS 'Enqueues a document for processing and adds it to the document_processing_queue. Returns the UUID of the document.'; 