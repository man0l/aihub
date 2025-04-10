/*
  # Initial Schema Setup for AI Knowledge Hub

  1. New Tables
    - `profiles`
      - Stores user profile information
      - Links to Supabase auth.users
    - `collections`
      - User-created knowledge collections
      - Organized by topics
    - `documents`
      - Stores processed content
      - Includes original content and AI-generated summaries
    - `topics`
      - Content categorization
    - `document_topics`
      - Many-to-many relationship between documents and topics

  2. Security
    - RLS enabled on all tables
    - Policies for user data access
*/

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- Create collections table
CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  cover_image text,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own collections"
  ON collections
  FOR ALL
  USING (auth.uid() = user_id);

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  original_content text,
  content_type text NOT NULL, -- 'youtube', 'pdf', 'webpage', etc.
  source_url text,
  transcription text,
  short_summary text,
  long_summary text,
  audio_summary_url text,
  collection_id uuid REFERENCES collections(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  processing_status text DEFAULT 'pending' -- 'pending', 'processing', 'completed', 'error'
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own documents"
  ON documents
  FOR ALL
  USING (auth.uid() = user_id);

-- Create topics table
CREATE TABLE IF NOT EXISTS topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Topics are readable by all authenticated users"
  ON topics
  FOR SELECT
  TO authenticated
  USING (true);

-- Create document_topics junction table
CREATE TABLE IF NOT EXISTS document_topics (
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, topic_id)
);

ALTER TABLE document_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage topics for their own documents"
  ON document_topics
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_topics.document_id
      AND documents.user_id = auth.uid()
    )
  );

-- Add some initial topics
INSERT INTO topics (name) VALUES
  ('Marketing'),
  ('Business'),
  ('Technology'),
  ('Design'),
  ('Writing'),
  ('Research')
ON CONFLICT (name) DO NOTHING;