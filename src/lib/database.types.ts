export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      collections: {
        Row: {
          id: string
          name: string
          description: string | null
          cover_image: string | null
          user_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          cover_image?: string | null
          user_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          cover_image?: string | null
          user_id?: string
          created_at?: string
          updated_at?: string
        }
      }
      documents: {
        Row: {
          id: string
          title: string
          original_content: string | null
          content_type: string
          source_url: string | null
          transcription: string | null
          short_summary: string | null
          long_summary: string | null
          audio_summary_url: string | null
          collection_id: string | null
          user_id: string
          created_at: string
          updated_at: string
          processing_status: string
        }
        Insert: {
          id?: string
          title: string
          original_content?: string | null
          content_type: string
          source_url?: string | null
          transcription?: string | null
          short_summary?: string | null
          long_summary?: string | null
          audio_summary_url?: string | null
          collection_id?: string | null
          user_id: string
          created_at?: string
          updated_at?: string
          processing_status?: string
        }
        Update: {
          id?: string
          title?: string
          original_content?: string | null
          content_type?: string
          source_url?: string | null
          transcription?: string | null
          short_summary?: string | null
          long_summary?: string | null
          audio_summary_url?: string | null
          collection_id?: string | null
          user_id?: string
          created_at?: string
          updated_at?: string
          processing_status?: string
        }
      }
      topics: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
        }
      }
      document_topics: {
        Row: {
          document_id: string
          topic_id: string
        }
        Insert: {
          document_id: string
          topic_id: string
        }
        Update: {
          document_id?: string
          topic_id?: string
        }
      }
    }
  }
}