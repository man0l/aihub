import { SupabaseClient } from '@supabase/supabase-js';

interface DocumentResult {
  success: boolean;
  document?: {
    id: string;
    [key: string]: any;
  };
  error?: any;
}

interface QueueMessage {
  message_id: string;
  message: string;
}

interface QueueResponse {
  data: QueueMessage | null;
  error: any | null;
}

/**
 * Database Service - Responsible for interacting with the database
 */
export class DatabaseService {
  private supabase: SupabaseClient;
  
  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }
  
  async updateVideoProcessingStatus(
    videoId: string, 
    userId: string, 
    status: 'processing' | 'completed' | 'error', 
    data: Record<string, any> = {}
  ) {
    return this.supabase
      .from('video_processing')
      .update({ 
        status, 
        ...data 
      })
      .eq('video_id', videoId)
      .eq('user_id', userId);
  }
  
  async createDocumentFromTranscription(
    videoId: string,
    transcription: string | null,
    sourceUrl: string,
    userId: string
  ): Promise<DocumentResult> {
    if (!transcription) return { success: false, error: 'No transcription available' };
    
    const { data, error } = await this.supabase
      .from('documents')
      .insert({
        title: `YouTube Video: ${videoId}`,
        original_content: transcription,
        content_type: 'youtube',
        source_url: sourceUrl,
        transcription: transcription,
        user_id: userId,
        processing_status: 'transcribed'
      })
      .select()
      .single();
    
    if (error) {
      console.error(`Error creating document for video ${videoId}:`, error);
      return { success: false, error };
    }
    
    console.log(`Created document for video ${videoId}: ${data.id}`);
    return { success: true, document: data };
  }
  
  async receiveMessageFromQueue(): Promise<QueueResponse> {
    return this.supabase
      .rpc('pgmq_receive', { 
        queue_name: 'video_processing_queue',
        visibility_timeout: 300
      });
  }
  
  async deleteMessageFromQueue(messageId: string | number) {
    const msgId = typeof messageId === 'string' 
                 ? parseInt(messageId, 10) 
                 : messageId;
                 
    return this.supabase
      .rpc('pgmq_delete', { 
        queue_name: 'video_processing_queue', 
        message_id: msgId
      });
  }
} 