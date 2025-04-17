import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Upload as UploadIcon, 
  Youtube, 
  FileText, 
  Link as LinkIcon, 
  Loader2,
  Plus,
  Trash2,
  Settings,
  FolderPlus,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { VideoSource, ProcessingOptions } from '../lib/types';
import axios from 'axios';

interface ProcessingError {
  message: string;
  details?: string;
}

interface Collection {
  id: string;
  name: string;
}

export default function Upload() {
  const [activeTab, setActiveTab] = useState('youtube');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [sources, setSources] = useState<VideoSource[]>([{ url: '', type: 'video' }]);
  const [webUrls, setWebUrls] = useState<string[]>(['']);
  const [showOptions, setShowOptions] = useState(false);
  const [collection, setCollection] = useState('');
  const [newCollection, setNewCollection] = useState('');
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [options, setOptions] = useState<ProcessingOptions>({
    generateShortForm: true,
    generateLongForm: true,
    generateAudio: true,
  });
  const [processingStatus, setProcessingStatus] = useState<{ [key: string]: string }>({});

  const { user } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (user) {
      fetchCollections();
    } else {
      console.log('No authenticated user found');
    }
  }, [user]);

  const fetchCollections = async () => {
    if (!user || !user.access_token) {
      setError({ message: 'You need to be logged in to view collections' });
      return;
    }
    
    try {
      console.log('Fetching collections for user:', user.id);
      const response = await axios.get('/api/upload/collections', {
        headers: { 
          Authorization: `Bearer ${user.access_token}`
        }
      });
      setCollections(response.data);
      console.log('Collections loaded:', response.data.length);
    } catch (error) {
      console.error('Failed to fetch collections:', error);
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setError({ message: 'Authentication failed. Please log in again.' });
      } else {
        setError({ 
          message: 'Failed to load collections', 
          details: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
  };

  const createNewCollection = async () => {
    if (!user || !user.access_token) {
      setError({ message: 'You need to be logged in to create collections' });
      return;
    }
    
    if (!newCollection.trim()) {
      setError({ message: 'Please enter a collection name' });
      return;
    }

    try {
      const response = await axios.post('/api/upload/collections', 
        { name: newCollection.trim() },
        { headers: { Authorization: `Bearer ${user.access_token}` } }
      );

      setCollections([...collections, response.data]);
      setCollection(response.data.id);
      setNewCollection('');
      setShowNewCollection(false);
    } catch (error) {
      console.error('Error creating collection:', error);
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setError({ message: 'Authentication failed. Please log in again.' });
      } else {
        setError({ 
          message: 'Failed to create collection', 
          details: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
  };

  const handleFileUpload = useCallback(async (files: FileList) => {
    if (!user || !user.access_token) {
      setError({ message: 'You need to be logged in to upload files' });
      return;
    }
    
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      Array.from(files).forEach(file => {
        formData.append('files', file);
      });
      formData.append('options', JSON.stringify({
        ...options,
        collectionId: collection || undefined,
      }));

      const response = await axios.post('/api/upload/files', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${user.access_token}`
        }
      });

      const results = response.data;
      const errors = results.filter((r: any) => r.status === 'error');
      
      if (errors.length > 0) {
        setError({
          message: 'Some files failed to process',
          details: errors.map((e: any) => e.error).join(', ')
        });
      }

      navigate('/library');
    } catch (err) {
      setError({
        message: 'Processing failed',
        details: err instanceof Error ? err.message : 'An unknown error occurred'
      });
    } finally {
      setLoading(false);
    }
  }, [user, navigate, options, collection]);

  const validateYouTubeUrl = (url: string): boolean => {
    try {
      const videoUrl = new URL(url);
      const isYouTubeDomain = 
        videoUrl.hostname === 'youtu.be' || 
        videoUrl.hostname === 'www.youtube.com' || 
        videoUrl.hostname === 'youtube.com';
        
      if (!isYouTubeDomain) {
        console.log('Invalid YouTube domain:', videoUrl.hostname);
        return false;
      }

      // Extract playlist ID and video ID
      const playlistId = videoUrl.searchParams.get('list');
      const videoId = videoUrl.searchParams.get('v');
      const isPlaylistUrl = videoUrl.pathname === '/playlist';
      
      console.log('URL validation details:', {
        playlistId,
        videoId,
        isPlaylistUrl,
        pathname: videoUrl.pathname
      });

      // Handle different URL patterns
      if (videoUrl.hostname === 'youtu.be') {
        // Short URL format (youtu.be/VIDEO_ID)
        return videoUrl.pathname.length > 1;
      } else if (isPlaylistUrl && playlistId) {
        // Direct playlist URL
        return true;
      } else if (playlistId || videoId) {
        // Video URL (with optional playlist)
        return true;
      }
      
      console.log('URL validation failed: No valid video or playlist ID found');
      return false;
    } catch (error) {
      console.error('Error validating YouTube URL:', error);
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user || !user.access_token) {
      setError({ message: 'You need to be logged in to process content' });
      return;
    }
    
    setLoading(true);
    setError(null);
    setProcessingStatus({});

    try {
      const processingOptions: ProcessingOptions = {
        ...options,
        collectionId: collection || undefined,
      };

      if (activeTab === 'youtube') {
        const validSources = sources.filter(source => source.url.trim());
        if (validSources.length === 0) {
          throw new Error('Please enter at least one valid URL');
        }

        // Validate YouTube URLs
        const invalidUrls = validSources.filter(source => !validateYouTubeUrl(source.url));
        if (invalidUrls.length > 0) {
          throw new Error('Please enter valid YouTube URLs');
        }

        // Process videos with status updates
        for (const source of validSources) {
          setProcessingStatus(prev => ({
            ...prev,
            [source.url]: 'Processing...'
          }));

          try {
            console.log('Sending YouTube processing request:', { 
              sources: [source], 
              options: processingOptions 
            });
            
            const response = await axios.post('/api/upload/youtube', 
              { sources: [source], options: processingOptions },
              { headers: { Authorization: `Bearer ${user.access_token}` } }
            );
            
            console.log('YouTube processing response:', response.data);
            
            const results = response.data;
            const sourceStatus = results[0]?.status === 'error'
              ? `Error: ${results[0].error}`
              : results[0]?.status === 'queued'
                ? 'Queued for processing'
                : 'Completed';

            setProcessingStatus(prev => ({
              ...prev,
              [source.url]: sourceStatus
            }));

            if (results[0]?.status === 'error') {
              setError({
                message: 'Some videos failed to process',
                details: results[0].error
              });
            }
          } catch (sourceError) {
            setProcessingStatus(prev => ({
              ...prev,
              [source.url]: 'Error'
            }));

            if (axios.isAxiosError(sourceError)) {
              console.error('YouTube API error details:', {
                status: sourceError.response?.status,
                statusText: sourceError.response?.statusText,
                data: sourceError.response?.data,
                url: sourceError.config?.url,
                method: sourceError.config?.method
              });
              
              if (sourceError.response?.status === 401) {
                setError({ message: 'Authentication failed. Please log in again.' });
                break;
              } else {
                setError({
                  message: 'Failed to process video',
                  details: sourceError.response?.data?.error || sourceError.message
                });
              }
            } else {
              console.error('Non-Axios error:', sourceError);
              setError({
                message: 'Failed to process video',
                details: sourceError instanceof Error ? sourceError.message : 'Unknown error'
              });
            }
          }
        }

        // Navigate only if there were no errors
        if (!error) {
          navigate('/library');
        }
      } else if (activeTab === 'webpage') {
        const validUrls = webUrls.filter(url => url.trim());
        if (validUrls.length === 0) {
          throw new Error('Please enter at least one valid URL');
        }

        try {
          const response = await axios.post('/api/upload/websites', 
            { urls: validUrls, options: processingOptions },
            { headers: { Authorization: `Bearer ${user.access_token}` } }
          );

          const results = response.data;
          const errors = results.filter((r: any) => r.status === 'error');
          
          if (errors.length > 0) {
            setError({
              message: 'Some websites failed to process',
              details: errors.map((e: any) => e.error).join(', ')
            });
          }

          navigate('/library');
        } catch (webError) {
          if (axios.isAxiosError(webError) && webError.response?.status === 401) {
            setError({ message: 'Authentication failed. Please log in again.' });
          } else {
            setError({
              message: 'Failed to process websites',
              details: webError instanceof Error ? webError.message : 'Unknown error'
            });
          }
        }
      }
    } catch (err) {
      setError({
        message: 'Processing failed',
        details: err instanceof Error ? err.message : 'An unknown error occurred'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSourceTypeChange = (index: number, type: VideoSource['type']) => {
    const newSources = [...sources];
    newSources[index] = { ...newSources[index], type };
    setSources(newSources);
  };

  const handleSourceUrlChange = (index: number, url: string) => {
    const newSources = [...sources];
    newSources[index] = { ...newSources[index], url };
    setSources(newSources);
  };

  const addSource = () => {
    setSources([...sources, { url: '', type: 'video' }]);
  };

  const removeSource = (index: number) => {
    setSources(sources.filter((_, i) => i !== index));
  };

  const addWebUrl = () => {
    setWebUrls([...webUrls, '']);
  };

  const removeWebUrl = (index: number) => {
    setWebUrls(webUrls.filter((_, i) => i !== index));
  };

  const handleWebUrlChange = (index: number, url: string) => {
    const newUrls = [...webUrls];
    newUrls[index] = url;
    setWebUrls(newUrls);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Upload Content</h1>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex">
            {[
              { id: 'youtube', name: 'YouTube', icon: Youtube },
              { id: 'file', name: 'File Upload', icon: FileText },
              { id: 'webpage', name: 'Website', icon: LinkIcon },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  relative min-w-0 flex-1 overflow-hidden py-4 px-4 text-center text-sm font-medium
                  ${
                    activeTab === tab.id
                      ? 'text-purple-600 border-b-2 border-purple-500'
                      : 'text-gray-500 hover:text-gray-700'
                  }
                `}
              >
                <div className="flex items-center justify-center">
                  <tab.icon className="h-5 w-5 mr-2" />
                  {tab.name}
                </div>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 mr-2" />
                <div>
                  <p className="font-medium">{error.message}</p>
                  {error.details && (
                    <p className="text-sm mt-1">{error.details}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'file' ? (
            <div className="flex justify-center">
              <div className="w-full max-w-lg">
                <label className="flex flex-col items-center px-4 py-6 border-2 border-dashed rounded-lg border-gray-300 cursor-pointer hover:border-purple-500">
                  <UploadIcon className="h-12 w-12 text-gray-400" />
                  <span className="mt-2 text-base text-gray-600">
                    Drop your files here or click to browse
                  </span>
                  <span className="mt-1 text-sm text-gray-500">
                    Support for PDF, DOC, DOCX, TXT
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt"
                    multiple
                    onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                    disabled={loading}
                  />
                </label>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                {activeTab === 'youtube' ? (
                  sources.map((source, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex gap-4">
                        <select
                          value={source.type}
                          onChange={(e) => handleSourceTypeChange(index, e.target.value as VideoSource['type'])}
                          className="w-32 rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500"
                          disabled={loading}
                        >
                          <option value="video">Single Video</option>
                          <option value="playlist">Playlist</option>
                          <option value="channel">Channel</option>
                        </select>
                        <div className="flex-1">
                          <input
                            type="text"
                            value={source.url}
                            onChange={(e) => handleSourceUrlChange(index, e.target.value)}
                            placeholder={`Enter YouTube ${source.type} URL`}
                            className="w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500"
                            disabled={loading}
                          />
                        </div>
                        {sources.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSource(index)}
                            className="p-2 text-gray-400 hover:text-red-500"
                            disabled={loading}
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        )}
                      </div>
                      {processingStatus[source.url] && (
                        <div className={`text-sm ${
                          processingStatus[source.url] === 'Completed'
                            ? 'text-green-600'
                            : processingStatus[source.url].startsWith('Error')
                            ? 'text-red-600'
                            : 'text-purple-600'
                        }`}>
                          {processingStatus[source.url]}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  webUrls.map((url, index) => (
                    <div key={index} className="flex gap-4">
                      <div className="flex-1">
                        <input
                          type="text"
                          value={url}
                          onChange={(e) => handleWebUrlChange(index, e.target.value)}
                          placeholder="Enter website URL"
                          className="w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500"
                        />
                      </div>
                      {webUrls.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeWebUrl(index)}
                          className="p-2 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  ))
                )}

                <button
                  type="button"
                  onClick={activeTab === 'youtube' ? addSource : addWebUrl}
                  className="flex items-center text-sm text-purple-600 hover:text-purple-500"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Another {activeTab === 'youtube' ? 'Source' : 'URL'}
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowOptions(!showOptions)}
                    className="flex items-center text-sm text-gray-600 hover:text-gray-900"
                  >
                    <Settings className="h-4 w-4 mr-1" />
                    Processing Options
                  </button>
                </div>

                {showOptions && (
                  <div className="bg-gray-50 p-4 rounded-md space-y-4">
                    <div className="space-y-2">
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={options.generateShortForm}
                          onChange={(e) => setOptions({ ...options, generateShortForm: e.target.checked })}
                          className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-700">Generate Short Form Summary (1-5 min read)</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={options.generateLongForm}
                          onChange={(e) => setOptions({ ...options, generateLongForm: e.target.checked })}
                          className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-700">Generate Long Form Summary (10-20 min read)</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={options.generateAudio}
                          onChange={(e) => setOptions({ ...options, generateAudio: e.target.checked })}
                          className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-700">Generate Audio Versions</span>
                      </label>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-sm font-medium text-gray-700">
                          Add to Collection
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowNewCollection(true)}
                          className="flex items-center text-sm text-purple-600 hover:text-purple-500"
                        >
                          <FolderPlus className="h-4 w-4 mr-1" />
                          New Collection
                        </button>
                      </div>

                      {showNewCollection ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newCollection}
                            onChange={(e) => setNewCollection(e.target.value)}
                            placeholder="Collection name"
                            className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500"
                          />
                          <button
                            type="button"
                            onClick={createNewCollection}
                            className="px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                          >
                            Create
                          </button>
                        </div>
                      ) : (
                        <select
                          value={collection}
                          onChange={(e) => setCollection(e.target.value)}
                          className="w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500"
                        >
                          <option value="">Select a collection</option>
                          {collections.map((col) => (
                            <option key={col.id} value={col.id}>
                              {col.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={loading || (activeTab === 'youtube' ? sources.every(s => !s.url.trim()) : webUrls.every(url => !url.trim()))}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin h-5 w-5 mr-2" />
                      Processing...
                    </>
                  ) : (
                    'Process Content'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}