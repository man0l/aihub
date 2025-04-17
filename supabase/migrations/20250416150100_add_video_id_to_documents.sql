-- Add video_id column to documents table
ALTER TABLE documents ADD COLUMN video_id TEXT;

-- Add an index to improve query performance when searching by video_id
CREATE INDEX idx_documents_video_id ON documents(video_id);

-- Add a comment to explain the column's purpose
COMMENT ON COLUMN documents.video_id IS 'The YouTube video ID for content sourced from YouTube';

-- Update existing YouTube documents with video_id if possible
UPDATE documents 
SET video_id = (
    CASE 
        WHEN source_url ~ 'youtube\.com/watch\?v=([^&]+)' THEN 
            (regexp_match(source_url, 'youtube\.com/watch\?v=([^&]+)'))[1]
        WHEN source_url ~ 'youtu\.be/([^?]+)' THEN 
            (regexp_match(source_url, 'youtu\.be/([^?]+)'))[1]
        ELSE NULL
    END
)
WHERE content_type = 'youtube' AND video_id IS NULL; 