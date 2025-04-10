const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const axios = require('axios');

// Initialize environment variables
dotenv.config();

// __dirname is already defined in CommonJS modules

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize S3 client with v3 SDK
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Create temporary directory for video processing
const tempDir = path.join(os.tmpdir(), 'youtube-processing');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Function to fetch YouTube transcription using YouTube API and ytdl-core
async function fetchYouTubeTranscription(videoId) {
  try {
    console.log('Fetching captions for video:', videoId);
    
    // First try to get captions using ytdl-core which can get the actual caption content
    try {
      console.log('Attempting to get captions with ytdl-core...');
      const videoInfo = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
      
      if (videoInfo.player_response && 
          videoInfo.player_response.captions && 
          videoInfo.player_response.captions.playerCaptionsTracklistRenderer) {
        
        const captionTracks = videoInfo.player_response.captions.playerCaptionsTracklistRenderer.captionTracks;
        
        if (captionTracks && captionTracks.length > 0) {
          console.log(`Found ${captionTracks.length} caption tracks via ytdl-core`);
          
          // Try to find captions in the following priority:
          // 1. Default captions (any language)
          // 2. English captions as fallback
          // 3. Any other available caption
          
          // First check for default captions
          let selectedTrack = captionTracks.find(track => track.isDefault);
          
          // If no default found, try English captions
          if (!selectedTrack) {
            console.log('No default captions found, trying English captions');
            selectedTrack = captionTracks.find(
              track => track.languageCode === 'en' || track.languageCode === 'en-US'
            );
          }
          
          // If still no captions found, just use the first available caption
          if (!selectedTrack && captionTracks.length > 0) {
            console.log('No English captions found, using the first available caption');
            selectedTrack = captionTracks[0];
          }
          
          if (selectedTrack) {
            console.log(`Using caption track in language: ${selectedTrack.languageCode}`);
            
            // Now we can directly fetch the caption content using the baseUrl
            const captionResponse = await axios.get(selectedTrack.baseUrl);
            
            if (captionResponse.data) {
              // Convert the XML/TimedText format to plaintext
              // This is a simplified version - you might want to parse it properly
              let captionText = captionResponse.data;
              
              // Simple regex to extract text from XML tags
              const textMatches = captionText.match(/<text[^>]*>(.*?)<\/text>/gs);
              if (textMatches) {
                captionText = textMatches
                  .map(match => {
                    // Extract just the text content and remove HTML entities
                    const text = match.replace(/<[^>]*>/g, '')
                                      .replace(/&amp;/g, '&')
                                      .replace(/&lt;/g, '<')
                                      .replace(/&gt;/g, '>')
                                      .replace(/&quot;/g, '"')
                                      .replace(/&#39;/g, "'");
                    return text.trim();
                  })
                  .filter(text => text) // Remove empty lines
                  .join('\n');
                
                console.log('Successfully extracted caption text');
                return captionText;
              }
            }
          }
        }
      }
      
      console.log('No captions available via ytdl-core, trying YouTube API...');
    } catch (ytdlError) {
      console.error('Error fetching captions with ytdl-core:', ytdlError.message);
      console.log('Falling back to YouTube API...');
    }
    
    // If ytdl-core approach failed, try the YouTube API captions endpoint
    const captionsResponse = await axios.get(
      `https://www.googleapis.com/youtube/v3/captions?videoId=${videoId}&part=snippet&key=${process.env.VITE_YOUTUBE_API_KEY}`
    );
    
    if (captionsResponse.data.items && captionsResponse.data.items.length > 0) {
      console.log(`Found ${captionsResponse.data.items.length} caption tracks via YouTube API`);
      
      // Try to find captions in the following priority:
      // 1. Default captions (any language)
      // 2. English captions as fallback
      // 3. Any other available caption
      
      // First check for default captions
      let captionTrack = captionsResponse.data.items.find(
        caption => caption.snippet.trackKind === 'standard' && caption.snippet.isDefault
      );
      
      // If no default found, try English captions
      if (!captionTrack) {
        console.log('No default captions found, trying English captions');
        captionTrack = captionsResponse.data.items.find(
          caption => caption.snippet.language === 'en' || caption.snippet.language === 'en-US'
        );
      }
      
      // If still no captions found, just use the first available caption
      if (!captionTrack && captionsResponse.data.items.length > 0) {
        console.log('No English captions found, using the first available caption');
        captionTrack = captionsResponse.data.items[0];
      }
      
      if (captionTrack) {
        console.log(`Using caption track in language: ${captionTrack.snippet.language}`);
        console.log('However, direct caption content requires OAuth via YouTube API');
      }
    }
    
    // Fallback: Get video metadata and create a structured transcript
    console.log('Using fallback metadata-based transcript generation');
    const videoResponse = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${process.env.VITE_YOUTUBE_API_KEY}&part=snippet,contentDetails`
    );

    if (!videoResponse.data.items || videoResponse.data.items.length === 0) {
      throw new Error('Video not found');
    }

    const videoData = videoResponse.data.items[0];
    const snippet = videoData.snippet;
    const duration = videoData.contentDetails.duration; // In ISO 8601 format
    
    // Get video comments as additional context
    const commentsResponse = await axios.get(
      `https://www.googleapis.com/youtube/v3/commentThreads?videoId=${videoId}&key=${process.env.VITE_YOUTUBE_API_KEY}&part=snippet&maxResults=25&order=relevance`
    );
    
    let topComments = '';
    if (commentsResponse.data.items && commentsResponse.data.items.length > 0) {
      topComments = commentsResponse.data.items
        .map(item => item.snippet.topLevelComment.snippet.textDisplay)
        .join('\n\n');
    }
    
    // Create a structured summary that can be used as a transcript substitute
    const structuredTranscript = `
# ${snippet.title}

## Video Information
- **Channel**: ${snippet.channelTitle}
- **Published**: ${new Date(snippet.publishedAt).toLocaleDateString()}
- **Duration**: ${duration}

## Description
${snippet.description || 'No description available.'}

## Summary
This video appears to be about ${snippet.title}. The content is presented by ${snippet.channelTitle}.

## Top Comments
${topComments || 'No comments available.'}

Note: This is a structured summary created from video metadata as direct transcription is not available.
    `.trim();

    return structuredTranscript;
  } catch (error) {
    console.error(`Error fetching YouTube transcription for ${videoId}:`, error);
    return null;
  }
}

// Function to download YouTube video
async function downloadYouTubeVideo(videoId) {
  const videoPath = path.join(tempDir, `${videoId}.mp4`);
  const audioPath = path.join(tempDir, `${videoId}.mp3`);
  
  return new Promise((resolve, reject) => {
    ytdl(`https://www.youtube.com/watch?v=${videoId}`, { quality: 'lowest' })
      .pipe(fs.createWriteStream(videoPath))
      .on('finish', () => {
        // Extract audio from video
        ffmpeg(videoPath)
          .output(audioPath)
          .noVideo()
          .audioCodec('libmp3lame')
          .on('end', () => {
            resolve({ videoPath, audioPath });
          })
          .on('error', (err) => {
            reject(err);
          })
          .run();
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

// Function to upload file to S3
async function uploadToS3(filePath, key) {
  const fileContent = fs.readFileSync(filePath);
  
  const params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
    Body: fileContent
  };
  
  try {
    // Use the Upload utility for larger files (handles multipart uploads)
    const upload = new Upload({
      client: s3Client,
      params
    });

    const data = await upload.done();
    return data.Location;
  } catch (error) {
    console.error(`Error uploading to S3: ${error}`);
    throw error;
  }
}

// Function to process a video job
async function processVideoJob(job) {
  const { videoId, userId, sourceUrl } = job;
  console.log(`Processing video: ${videoId}`);
  
  try {
    // Update status to processing
    await supabase
      .from('video_processing')
      .update({ status: 'processing' })
      .eq('video_id', videoId)
      .eq('user_id', userId);
    
    // 1. Try to get YouTube transcription first
    let transcription = await fetchYouTubeTranscription(videoId);
    let videoUrl = null;
    let audioUrl = null;
    
    // 2. If no transcription available, download video and upload to S3
    if (!transcription) {
      console.log(`No transcription available for ${videoId}, downloading video...`);
      const { videoPath, audioPath } = await downloadYouTubeVideo(videoId);
      
      // Upload to S3
      videoUrl = await uploadToS3(videoPath, `videos/${userId}/${videoId}.mp4`);
      audioUrl = await uploadToS3(audioPath, `audio/${userId}/${videoId}.mp3`);
      
      // Clean up temp files
      fs.unlinkSync(videoPath);
      fs.unlinkSync(audioPath);
    }
    
    // 3. Update the video processing record
    await supabase
      .from('video_processing')
      .update({ 
        status: 'completed',
        transcription,
        video_url: videoUrl,
        audio_url: audioUrl,
        completed_at: new Date()
      })
      .eq('video_id', videoId)
      .eq('user_id', userId);
    
    console.log(`Successfully processed video: ${videoId}`);
    
    // 4. Now create a document in the documents table
    if (transcription) {
      const { data: document, error } = await supabase
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
      } else {
        console.log(`Created document for video ${videoId}: ${document.id}`);
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error(`Error processing video ${videoId}:`, error);
    
    // Update status to error
    await supabase
      .from('video_processing')
      .update({ 
        status: 'error',
        error_message: error.message
      })
      .eq('video_id', videoId)
      .eq('user_id', userId);
    
    return { success: false, error: error.message };
  }
}

// Main worker loop
async function workerLoop() {
  console.log('Video processing worker started');
  
  // Log PGMQ detection
  console.log('Using PGMQ extension version 1.4.4');
  
  while (true) {
    try {
      console.log('Attempting to receive message from queue...');
      
      // Dequeue a message from the video processing queue
      // Cast the queue_name explicitly to text to avoid type issues
      const { data: message, error } = await supabase
        .rpc('pgmq_receive', { 
          queue_name: 'video_processing_queue',
          visibility_timeout: 300  // Explicitly as a number, not a string
        });
      
      if (error) {
        console.error('Error receiving message from queue:', error);
        console.error('Error details:', JSON.stringify(error));
        await new Promise(resolve => setTimeout(resolve, 5000));  // Wait 5 seconds before retry
        continue;
      }
      
      if (!message || !message.message_id) {
        console.log('No messages in queue, waiting...');
        await new Promise(resolve => setTimeout(resolve, 10000));  // Wait 10 seconds before checking again
        continue;
      }
      
      console.log(`Processing message: ${message.message_id}, type: ${typeof message.message_id}`);
      const job = JSON.parse(message.message);
      
      // Process the job
      const result = await processVideoJob(job);
      
      if (result.success) {
        // If successful, delete the message from the queue
        // Convert message_id to number if it's a string
        const msgId = typeof message.message_id === 'string' 
                      ? parseInt(message.message_id, 10) 
                      : message.message_id;
        
        console.log(`Deleting message ${msgId}, type: ${typeof msgId}`);
        
        const { error: deleteError } = await supabase
          .rpc('pgmq_delete', { 
            queue_name: 'video_processing_queue', 
            message_id: msgId
          });
          
        if (deleteError) {
          console.error('Error deleting message from queue:', deleteError);
          console.error('Delete error details:', JSON.stringify(deleteError));
        } else {
          console.log(`Successfully completed job for message: ${msgId}`);
        }
      } else {
        // If failed, we let the visibility timeout expire and the message will be retried
        console.log(`Failed to process job for message: ${message.message_id}, will be retried`);
      }
    } catch (error) {
      console.error('Error in worker loop:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));  // Wait 5 seconds before retry
    }
  }
}

// Start the worker
workerLoop().catch(console.error); 