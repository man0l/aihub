import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { FolderOpen, Search, Filter, Play, Pause, FileText, Youtube, Globe, ChevronDown, ChevronUp, Trash2, X } from 'lucide-react';
import { Database } from '../lib/database.types';
import { cn } from '../lib/utils';

type Document = Database['public']['Tables']['documents']['Row'] & {
  short_summary_audio?: string | null;
  long_summary_audio?: string | null;
};
type Collection = Database['public']['Tables']['collections']['Row'];

// Add utility function to decode UTF-8 strings
const decodeUTF8 = (str: string): string => {
  try {
    return decodeURIComponent(escape(str));
  } catch (e) {
    console.warn('Failed to decode UTF-8 string:', e);
    return str;
  }
};

export default function Library() {
  const { user } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDocs, setExpandedDocs] = useState<string[]>([]);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isNewCollectionModalOpen, setIsNewCollectionModalOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    async function fetchLibraryData() {
      const userId = user!.id;
      try {
        const [collectionsResponse, documentsResponse] = await Promise.all([
          supabase
            .from('collections')
            .select('*')
            .eq('user_id', userId)
            .order('name'),
          supabase
            .from('documents')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
        ]);

        if (collectionsResponse.error) throw collectionsResponse.error;
        if (documentsResponse.error) throw documentsResponse.error;

        setCollections(collectionsResponse.data);
        setDocuments(documentsResponse.data);
      } catch (error) {
        console.error('Error fetching library data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchLibraryData();
  }, [user]);

  const getContentIcon = (type: string) => {
    switch (type) {
      case 'youtube':
        return Youtube;
      case 'webpage':
        return Globe;
      default:
        return FileText;
    }
  };

  const toggleExpand = (docId: string) => {
    setExpandedDocs(prev => 
      prev.includes(docId) 
        ? prev.filter(id => id !== docId)
        : [...prev, docId]
    );
  };

  const handleAudioPlay = (audioUrl: string | null | undefined) => {
    if (!audioUrl) return;
    
    if (playingAudio === audioUrl) {
      // Stop playing
      const audio = document.querySelector(`audio[src="${audioUrl}"]`) as HTMLAudioElement;
      audio?.pause();
      setPlayingAudio(null);
    } else {
      // Stop any currently playing audio
      if (playingAudio) {
        const currentAudio = document.querySelector(`audio[src="${playingAudio}"]`) as HTMLAudioElement;
        currentAudio?.pause();
      }
      // Start playing new audio
      const newAudio = document.querySelector(`audio[src="${audioUrl}"]`) as HTMLAudioElement;
      newAudio?.play();
      setPlayingAudio(audioUrl);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!user?.id) return;

    try {
      const { error } = await supabase
        .from('documents')
        .delete()
        .eq('id', docId)
        .eq('user_id', user.id);

      if (error) throw error;

      // Update local state
      setDocuments(prev => prev.filter(doc => doc.id !== docId));
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Error deleting document:', error);
    }
  };

  const handleCollectionClick = (collectionId: string) => {
    setSelectedCollection(prev => prev === collectionId ? null : collectionId);
  };

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCollection = selectedCollection ? doc.collection_id === selectedCollection : true;
    return matchesSearch && matchesCollection;
  });

  const createCollection = async () => {
    if (!user?.id || !newCollectionName.trim()) return;

    setIsCreatingCollection(true);
    try {
      const { data, error } = await supabase
        .from('collections')
        .insert({
          name: newCollectionName.trim(),
          user_id: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      setCollections(prev => [...prev, data]);
      setNewCollectionName('');
      setIsNewCollectionModalOpen(false);
    } catch (error) {
      console.error('Error creating collection:', error);
      alert('Failed to create collection. Please try again.');
    } finally {
      setIsCreatingCollection(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">My Library</h1>
        <button 
          onClick={() => setIsNewCollectionModalOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700"
        >
          <FolderOpen className="h-5 w-5 mr-2" />
          New Collection
        </button>
      </div>

      {/* New Collection Modal */}
      {isNewCollectionModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-medium text-gray-900">Create New Collection</h2>
              <button
                onClick={() => setIsNewCollectionModalOpen(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="collection-name" className="block text-sm font-medium text-gray-700">
                  Collection Name
                </label>
                <input
                  type="text"
                  id="collection-name"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                  placeholder="Enter collection name"
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setIsNewCollectionModalOpen(false)}
                  className="inline-flex justify-center py-2 px-4 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createCollection}
                  disabled={!newCollectionName.trim() || isCreatingCollection}
                  className={cn(
                    "inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600",
                    (!newCollectionName.trim() || isCreatingCollection) 
                      ? "opacity-50 cursor-not-allowed" 
                      : "hover:bg-purple-700"
                  )}
                >
                  {isCreatingCollection ? 'Creating...' : 'Create Collection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex space-x-4">
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
            placeholder="Search in library..."
          />
        </div>
        <button className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
          <Filter className="h-5 w-5 mr-2" />
          Filters
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Collections Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-900">Collections</h2>
              </div>
              <div className="divide-y divide-gray-200">
                {collections.map((collection) => (
                  <button
                    key={collection.id}
                    onClick={() => handleCollectionClick(collection.id)}
                    className={cn(
                      "w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors",
                      selectedCollection === collection.id && "bg-purple-50"
                    )}
                  >
                    <div className="flex items-center">
                      <FolderOpen className={cn(
                        "h-5 w-5 mr-2",
                        selectedCollection === collection.id ? "text-purple-600" : "text-gray-400"
                      )} />
                      <span className={cn(
                        "text-sm font-medium",
                        selectedCollection === collection.id ? "text-purple-600" : "text-gray-700"
                      )}>
                        {collection.name}
                      </span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {documents.filter(d => d.collection_id === collection.id).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Documents List */}
          <div className="lg:col-span-3 space-y-4">
            {filteredDocuments.map((doc) => {
              const Icon = getContentIcon(doc.content_type);
              const isExpanded = expandedDocs.includes(doc.id);
              const isPlayingShort = playingAudio === doc.short_summary_audio;
              const isPlayingLong = playingAudio === doc.long_summary_audio;

              return (
                <div key={doc.id} className="bg-white rounded-lg border border-gray-200 hover:shadow-md transition-shadow duration-200 overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start space-x-4">
                      <div className="flex-shrink-0">
                        <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
                          <Icon className="h-5 w-5 text-purple-600" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h3 className="text-sm font-medium text-gray-900">{decodeUTF8(doc.title)}</h3>
                            <p className="mt-1 text-sm text-gray-500">
                              {new Date(doc.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center space-x-2">
                            {deleteConfirm === doc.id ? (
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => handleDeleteDocument(doc.id)}
                                  className="text-red-600 hover:text-red-700 text-sm font-medium"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setDeleteConfirm(null)}
                                  className="text-gray-500 hover:text-gray-600 text-sm"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirm(doc.id)}
                                className="text-gray-400 hover:text-red-500"
                              >
                                <Trash2 className="h-5 w-5" />
                              </button>
                            )}
                            <button
                              onClick={() => toggleExpand(doc.id)}
                              className="text-gray-400 hover:text-gray-600"
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-5 w-5" />
                              ) : (
                                <ChevronDown className="h-5 w-5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Short Form Summary */}
                        {doc.short_summary && (
                          <div className="mt-4">
                            <h4 className="text-sm font-medium text-gray-900 mb-2">Short Form Summary (1-5 min read)</h4>
                            <p className="text-sm text-gray-600 whitespace-pre-line">
                              {doc.short_summary}
                            </p>
                            {doc.short_summary_audio && (
                              <div className="mt-2">
                                <button
                                  onClick={() => handleAudioPlay(doc.short_summary_audio)}
                                  className="inline-flex items-center text-sm text-purple-600 hover:text-purple-500"
                                >
                                  {isPlayingShort ? (
                                    <Pause className="h-4 w-4 mr-1" />
                                  ) : (
                                    <Play className="h-4 w-4 mr-1" />
                                  )}
                                  {isPlayingShort ? 'Pause Short Form Audio' : 'Play Short Form Audio'}
                                </button>
                                <audio src={doc.short_summary_audio} className="hidden" />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Long Form Summary */}
                        {isExpanded && doc.long_summary && (
                          <div className="mt-4">
                            <h4 className="text-sm font-medium text-gray-900 mb-2">Long Form Summary (10-20 min read)</h4>
                            <p className="text-sm text-gray-600 whitespace-pre-line">
                              {doc.long_summary}
                            </p>
                            {doc.long_summary_audio && (
                              <div className="mt-2">
                                <button
                                  onClick={() => handleAudioPlay(doc.long_summary_audio)}
                                  className="inline-flex items-center text-sm text-purple-600 hover:text-purple-500"
                                >
                                  {isPlayingLong ? (
                                    <Pause className="h-4 w-4 mr-1" />
                                  ) : (
                                    <Play className="h-4 w-4 mr-1" />
                                  )}
                                  {isPlayingLong ? 'Pause Long Form Audio' : 'Play Long Form Audio'}
                                </button>
                                <audio src={doc.long_summary_audio} className="hidden" />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Additional Content */}
                        {isExpanded && (
                          <div className="mt-4 space-y-4 border-t pt-4">
                            {/* Processing Status */}
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-medium text-gray-500">Status:</span>
                              <span className={`text-sm ${
                                doc.processing_status === 'completed' 
                                  ? 'text-green-600' 
                                  : doc.processing_status === 'error'
                                  ? 'text-red-600'
                                  : 'text-yellow-600'
                              }`}>
                                {doc.processing_status.charAt(0).toUpperCase() + doc.processing_status.slice(1)}
                              </span>
                            </div>

                            {/* Original Content or Transcription */}
                            {(doc.original_content || doc.transcription) && (
                              <div>
                                <h4 className="text-sm font-medium text-gray-900 mb-2">
                                  {doc.content_type === 'youtube' ? 'Transcription' : 'Original Content'}
                                </h4>
                                <p className="text-sm text-gray-600 whitespace-pre-line">
                                  {doc.transcription || doc.original_content}
                                </p>
                              </div>
                            )}

                            {/* Source Link */}
                            {doc.source_url && (
                              <div>
                                <a
                                  href={doc.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-purple-600 hover:text-purple-500"
                                >
                                  View Original Source
                                </a>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}