/*
  # Create storage bucket for media files

  1. New Storage Bucket
    - Creates a 'media' bucket for storing audio summaries and other media files
  2. Security
    - Enables public access for reading files
    - Restricts uploads to authenticated users only
*/

-- Create the storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

-- Create policy to allow public access to files in the bucket
CREATE POLICY "Media files are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'media');

-- Create policy to allow authenticated users to upload files
CREATE POLICY "Users can upload media files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'media');

-- Create policy to allow users to update their own files
CREATE POLICY "Users can update their own media files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'media' AND owner = auth.uid());

-- Create policy to allow users to delete their own files
CREATE POLICY "Users can delete their own media files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'media' AND owner = auth.uid());