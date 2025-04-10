-- Wrapper functions for PGMQ functions to make them accessible via Supabase RPC

-- Wrapper for pgmq.create
CREATE OR REPLACE FUNCTION public.pgmq_create(
  queue_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE format('SELECT pgmq.create(%L)', queue_name);
END;
$$;

-- Wrapper for pgmq.send
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
  EXECUTE format('SELECT pgmq.send(%L, %L)', queue_name, message) INTO msg_id;
  RETURN msg_id;
END;
$$;

-- Wrapper for pgmq.receive
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
  EXECUTE format('SELECT to_jsonb(pgmq.receive(%L, %L))', queue_name, visibility_timeout) INTO result;
  RETURN result;
END;
$$;

-- Wrapper for pgmq.delete
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
  EXECUTE format('SELECT pgmq.delete(%L, %L)', queue_name, message_id) INTO success;
  RETURN success;
END;
$$;

-- Wrapper for pgmq.archive_queue
CREATE OR REPLACE FUNCTION public.pgmq_archive_queue(
  queue_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  success BOOLEAN;
BEGIN
  EXECUTE format('SELECT pgmq.archive_queue(%L)', queue_name) INTO success;
  RETURN success;
END;
$$;

-- Wrapper for pgmq.list_queues
CREATE OR REPLACE FUNCTION public.pgmq_list_queues()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  EXECUTE 'SELECT jsonb_agg(q) FROM pgmq.list_queues() q' INTO result;
  RETURN result;
END;
$$; 