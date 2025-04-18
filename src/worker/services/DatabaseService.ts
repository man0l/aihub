import { SupabaseClient } from '@supabase/supabase-js';

// Export the DocumentResult interface for use in VideoProcessor
export interface DocumentResult {
  success: boolean;
  document?: {
    id: string;
    [key: string]: any;
  };
  error?: any;
}

interface QueueMessage {
  msg_id: string;
  message: any;
  vt: string;
  read_ct: number;
  enqueued_at: string;
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
  
  async updateDocumentStatus(
    documentId: string,
    status: 'processing' | 'completed' | 'error' | 'transcribed',
    data: Record<string, any> = {}
  ) {
    // Ensure we don't accidentally overwrite video_id if it's not explicitly provided
    const updateData = {
      processing_status: status,
      updated_at: new Date().toISOString(),
      ...data  // Allow explicit video_id updates if needed
    };

    return this.supabase
      .from('documents')
      .update(updateData)
      .eq('id', documentId);
  }
  
  async createDocumentFromTranscription(
    videoId: string,
    transcription: string | null,
    sourceUrl: string,
    userId: string
  ): Promise<DocumentResult> {
    if (!transcription) return { success: false, error: 'No transcription available' };
    
    // First, check if a document already exists for this video and user
    const { data: existingDoc, error: queryError } = await this.supabase
      .from('documents')
      .select('id')
      .eq('source_url', sourceUrl)
      .eq('user_id', userId)
      .eq('content_type', 'youtube')
      .single();
    
    if (queryError && queryError.code !== 'PGRST116') { // PGRST116 is "no rows returned" error
      console.error(`Error checking for existing document for video ${videoId}:`, queryError);
      return { success: false, error: queryError };
    }
    
    if (existingDoc) {
      // Update the existing document
      console.log(`Updating existing document for video ${videoId}: ${existingDoc.id}`);
      const { data, error } = await this.supabase
        .from('documents')
        .update({
          original_content: transcription,
          transcription: transcription,
          processing_status: 'transcribed',
          video_id: videoId,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingDoc.id)
        .select()
        .single();
      
      if (error) {
        console.error(`Error updating document for video ${videoId}:`, error);
        return { success: false, error };
      }
      
      console.log(`Updated document for video ${videoId}: ${data.id}`);
      return { success: true, document: data };
    } else {
      // Create a new document if none exists
      const { data, error } = await this.supabase
        .from('documents')
        .insert({
          title: `YouTube Video: ${videoId}`,
          original_content: transcription,
          content_type: 'youtube',
          source_url: sourceUrl,
          transcription: transcription,
          user_id: userId,
          processing_status: 'transcribed',
          video_id: videoId
        })
        .select()
        .single();
      
      if (error) {
        console.error(`Error creating document for video ${videoId}:`, error);
        return { success: false, error };
      }
      
      console.log(`Created new document for video ${videoId}: ${data.id}`);
      return { success: true, document: data };
    }
  }
  
  async receiveMessageFromQueue(queueName: string = 'video_processing_queue'): Promise<QueueResponse> {
    return this.supabase
      .rpc('pgmq_receive', { 
        queue_name: queueName,
        visibility_timeout: 300
      });
  }
  
  async receiveVideoMessage(): Promise<QueueResponse> {
    return this.receiveMessageFromQueue('video_processing_queue');
  }
  
  async receiveWebsiteMessage(): Promise<QueueResponse> {
    return this.receiveMessageFromQueue('website_processing_queue');
  }
  
  async receiveDocumentMessage(): Promise<QueueResponse> {
    return this.receiveMessageFromQueue('document_processing_queue');
  }
  
  async deleteMessageFromQueue(messageId: string | number, queueName: string = 'video_processing_queue') {
    const msgId = typeof messageId === 'string' 
                 ? parseInt(messageId, 10) 
                 : messageId;
                 
    return this.supabase
      .rpc('pgmq_delete', { 
        queue_name: queueName, 
        message_id: msgId
      });
  }
  
  async deleteVideoMessage(messageId: string | number) {
    return this.deleteMessageFromQueue(messageId, 'video_processing_queue');
  }
  
  async deleteWebsiteMessage(messageId: string | number) {
    return this.deleteMessageFromQueue(messageId, 'website_processing_queue');
  }

  async deleteDocumentMessage(messageId: string | number) {
    return this.deleteMessageFromQueue(messageId, 'document_processing_queue');
  }
} 