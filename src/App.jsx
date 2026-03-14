import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Video, Calendar, Upload, Trash2, Clock, CheckCircle, XCircle, Lock, LogOut } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
axios.defaults.baseURL = API_BASE_URL;

// Setup axios interceptors for auth
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axios.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      // Only reload if we are not already trying to login
      if (window.location.pathname !== '/login' && !error.config.url.includes('/api/login')) {
        window.location.reload();
      }
    }
    return Promise.reject(error);
  }
);

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));
  const [password, setPassword] = useState('');

  const [schedules, setSchedules] = useState([]);
  const [videos, setVideos] = useState([]);
  const [activeTab, setActiveTab] = useState('schedule');

  // Form state
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newVideo, setNewVideo] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newFocus, setNewFocus] = useState('');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadController, setUploadController] = useState(null);
  const [currentUploadId, setCurrentUploadId] = useState(null);

  // Preview State
  const [previewVideo, setPreviewVideo] = useState(null);

  // Cleanup abort on unmount or manual abort
  useEffect(() => {
    return () => {
      if (uploading && uploadController) {
          uploadController.abort();
      }
      if (uploading && currentUploadId) {
          axios.post('/api/upload/abort', { uploadId: currentUploadId }).catch(() => {});
      }
    };
  }, [uploading, uploadController, currentUploadId]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSchedules();
      fetchVideos();
    }
  }, [isAuthenticated]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post('/api/login', { password });
      localStorage.setItem('token', res.data.token);
      setIsAuthenticated(true);
    } catch (err) {
      alert('Invalid password');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
  };

  const fetchSchedules = async () => {
    try {
      const res = await axios.get('/api/schedule');
      setSchedules(res.data);
    } catch (e) { console.error('Error fetching schedules', e); }
  };

  const fetchVideos = async () => {
    try {
      const res = await axios.get('/api/videos');
      setVideos(res.data);
      if (res.data.length > 0 && !newVideo) setNewVideo(res.data[0].name);
    } catch (e) { console.error('Error fetching videos', e); }
  };

  const handleAddSchedule = async (e) => {
    e.preventDefault();
    if (!newDate || !newTime || !newVideo) return;
    try {
      await axios.post('/api/schedule', {
        date: newDate, time: newTime, video: newVideo, title: newTitle, focusArea: newFocus, isActive: true
      });
      fetchSchedules();
      setNewDate(''); setNewTime(''); setNewTitle(''); setNewFocus('');
    } catch (e) { console.error(e); }
  };

  const handleDeleteSchedule = async (id) => {
    try {
      await axios.delete(`/api/schedule/${id}`);
      fetchSchedules();
    } catch (e) { console.error(e); }
  };

  const handleDeleteVideo = async (filename) => {
    if (!window.confirm(`Are you sure you want to delete ${filename}?`)) return;
    try {
      await axios.delete(`/api/videos/${filename}`);
      fetchVideos();
      if (newVideo === filename) {
        setNewVideo('');
      }
      if (previewVideo === filename) {
        setPreviewVideo(null);
      }
    } catch (e) { 
      console.error(e); 
      alert('Failed to delete video');
    }
  };

  const handleToggleActive = async (id, currentStatus) => {
    try {
      const schedule = schedules.find(s => s.id === id);
      await axios.put(`/api/schedule/${id}`, { ...schedule, isActive: !currentStatus });
      fetchSchedules();
    } catch (e) { console.error(e); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    
    const abortController = new AbortController();
    setUploadController(abortController);
    
    // Generate a unique ID for this upload session
    const uploadId = Date.now().toString() + '-' + Math.random().toString(36).substring(7);
    setCurrentUploadId(uploadId);

    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let uploadedChunks = 0;
    
    try {
        // Create an array of chunk data
        const chunks = [];
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const start = chunkIndex * CHUNK_SIZE;
            const end = Math.min(file.size, start + CHUNK_SIZE);
            const chunk = file.slice(start, end);
            chunks.push({ chunkIndex, chunk });
        }

        // Upload chunks with a concurrency limit (e.g., 3 parallel uploads)
        const CONCURRENCY_LIMIT = 3;
        const activeUploads = new Set();
        
        let chunkIdx = 0;
        
        while (chunkIdx < chunks.length || activeUploads.size > 0) {
            if (abortController.signal.aborted) throw new Error('Upload aborted');
            
            if (activeUploads.size < CONCURRENCY_LIMIT && chunkIdx < chunks.length) {
                const { chunkIndex, chunk } = chunks[chunkIdx];
                chunkIdx++;

                const formData = new FormData();
                formData.append('video', chunk, file.name); // Send blob as file
                formData.append('uploadId', uploadId);
                formData.append('chunkIndex', chunkIndex);

                const uploadPromise = axios.post('/api/upload/chunk', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    signal: abortController.signal
                }).then(() => {
                    uploadedChunks++;
                    setUploadProgress(Math.round((uploadedChunks * 100) / totalChunks));
                }).finally(() => {
                    activeUploads.delete(uploadPromise);
                });
                
                activeUploads.add(uploadPromise);
            } else {
                 // Wait for at least one upload to finish before starting another
                 await Promise.race(activeUploads);
            }
        }

        // All chunks uploaded, signal completion
        await axios.post('/api/upload/complete', {
            uploadId,
            originalFilename: file.name,
            totalChunks
        }, { signal: abortController.signal });

        fetchVideos();
    } catch (err) {
        if (!abortController.signal.aborted) {
             console.error('Upload failed:', err);
             alert('Upload failed. Cleaning up partial files.');
        } else {
             console.log('Upload was intentionally aborted');
        }
        
        // Attempt immediate cleanup on backend
        try {
             await axios.post('/api/upload/abort', { uploadId });
        } catch (e) {
             console.error('Failed to clean up aborted upload:', e);
        }
    } finally {
        setUploading(false);
        setUploadController(null);
        setCurrentUploadId(null);
        // Reset file input
        e.target.value = '';
    }
  };

  const handleManualAbort = () => {
       if (uploadController) uploadController.abort();
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 w-full max-w-sm">
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center">
              <Lock className="w-7 h-7 text-indigo-600" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center mb-2 text-slate-800">Admin Access</h2>
          <p className="text-center text-slate-500 mb-8 text-sm">Enter your password to continue</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input 
                type="password" 
                placeholder="Password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                required
              />
            </div>
            <button type="submit" className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 active:scale-95 transition-all shadow-md shadow-indigo-200">
              Secure Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center">
              <Video className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
              YogSaathi Streamer
            </h1>
          </div>
          <nav className="flex gap-4 items-center">
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'schedule' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Master Schedule
            </button>
            <button
              onClick={() => setActiveTab('videos')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'videos' ? 'bg-purple-50 text-purple-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Video Library
            </button>
            <div className="h-6 w-px bg-slate-200 mx-2"></div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" title="Log out">
              <LogOut className="w-5 h-5" />
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {activeTab === 'schedule' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Schedule List */}
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-2xl font-semibold flex items-center gap-2">
                <Calendar className="w-6 h-6 text-indigo-500" />
                Live Broadcast Schedule
              </h2>

              <div className="grid grid-cols-1 gap-4">
                {schedules.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500">
                    No streams scheduled. Add one to get started!
                  </div>
                ) : (
                  schedules.map(schedule => (
                    <div key={schedule.id} className={`bg-white border rounded-2xl p-5 shadow-sm transition-all duration-300 ${schedule.isActive ? 'border-indigo-200 ring-1 ring-indigo-50' : 'border-slate-200 opacity-70'}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex gap-4">
                          <div className={`flex flex-col items-center justify-center px-4 py-3 rounded-xl ${schedule.isActive ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                            <Calendar className="w-4 h-4 mb-1" />
                            <span className="font-bold text-sm mb-2">{schedule.date || 'No Date'}</span>
                            <Clock className="w-4 h-4 mb-1" />
                            <span className="font-bold text-lg">{schedule.time}</span>
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-800">{schedule.title || 'Untitled Session'}</h3>
                            <p className="text-sm text-slate-500 font-medium mb-2">{schedule.focusArea || 'General Yoga'}</p>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                              <Video className="w-3.5 h-3.5" />
                              {schedule.video}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleActive(schedule.id, schedule.isActive)}
                            className={`p-2 rounded-lg transition-colors ${schedule.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                            title={schedule.isActive ? "Deactivate" : "Activate"}
                          >
                            {schedule.isActive ? <CheckCircle className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
                          </button>
                          <button
                            onClick={() => handleDeleteSchedule(schedule.id)}
                            className="p-2 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Add Schedule Form */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm h-fit sticky top-24">
              <h3 className="text-lg font-bold mb-4">Add New Slot</h3>
              <form onSubmit={handleAddSchedule} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Date</label>
                    <input required type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Time (24h)</label>
                    <input required type="time" value={newTime} onChange={e => setNewTime(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Select Video</label>
                  <select required value={newVideo} onChange={e => setNewVideo(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none bg-white">
                    {videos.length === 0 && <option value="">No videos available</option>}
                    {videos.map(v => (
                      <option key={v.name} value={v.name}>{v.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Class Title</label>
                  <input required type="text" placeholder="e.g. Morning Vinyasa" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Focus Area</label>
                  <input required type="text" placeholder="e.g. Flexibility" value={newFocus} onChange={e => setNewFocus(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                </div>
                <button type="submit" className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-md shadow-indigo-200 transition-all active:scale-95">
                  Schedule Broadcast
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'videos' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-semibold flex items-center gap-2">
                <Video className="w-6 h-6 text-purple-500" />
                Video Library
              </h2>
            </div>

            {/* Upload Area */}
            <div className="bg-white border-2 border-dashed border-purple-200 rounded-3xl p-10 text-center hover:bg-purple-50 transition-colors relative">
              <input
                type="file"
                accept="video/mp4"
                onChange={handleFileUpload}
                disabled={uploading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center pointer-events-none w-full">
                {uploading ? (
                  <div className="w-full max-w-md mx-auto">
                    <div className="flex justify-between text-sm text-purple-700 font-bold mb-2">
                      <span>Uploading securely...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-purple-100 rounded-full h-3 mb-4 overflow-hidden">
                      <div className="bg-purple-600 h-3 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                    </div>
                    <button 
                         onClick={handleManualAbort}
                         className="pointer-events-auto px-4 py-2 mt-2 bg-rose-100 text-rose-600 rounded-lg text-sm font-semibold hover:bg-rose-200 transition-colors"
                    >
                        Cancel Upload
                    </button>
                  </div>
                ) : (
                  <Upload className="w-12 h-12 text-purple-400 mb-4" />
                )}
                {!uploading && (
                  <h3 className="text-lg font-bold text-slate-800">
                    Click or drag .mp4 video to upload
                  </h3>
                )}
                <p className="text-sm text-slate-500 mt-2">Maximum file size is restricted by your server (up to 9GB supported).</p>
              </div>
            </div>

            {/* Video List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {videos.map(video => (
                <div 
                  key={video.name} 
                  className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm group hover:border-purple-300 transition-colors relative cursor-pointer"
                  onClick={() => setPreviewVideo(video.name)}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteVideo(video.name);
                    }}
                    className="absolute top-2 right-2 p-2 bg-white/80 backdrop-blur-sm shadow-sm rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-colors opacity-0 group-hover:opacity-100 z-10"
                    title="Delete Video"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="w-full aspect-video bg-slate-100 rounded-xl mb-4 flex items-center justify-center border border-slate-200 relative overflow-hidden">
                    <Video className="w-10 h-10 text-slate-300" />
                  </div>
                  <h4 className="font-semibold text-slate-800 truncate">{video.name}</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    {(video.size / (1024 * 1024 * 1024)).toFixed(2)} GB • {new Date(video.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
              {videos.length === 0 && (
                <div className="col-span-full py-12 text-center text-slate-500 bg-white border border-slate-200 rounded-2xl">
                  Your library is empty. Upload your first yoga flow to get started.
                </div>
              )}
            </div>
            
            {/* Video Preview Modal */}
            {previewVideo && (
              <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl relative">
                  <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <Video className="w-5 h-5 text-indigo-500" />
                      Previewing: {previewVideo}
                    </h3>
                    <button 
                      onClick={() => setPreviewVideo(null)}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
                    >
                      <XCircle className="w-6 h-6" />
                    </button>
                  </div>
                  <div className="aspect-video bg-black w-full">
                    <video 
                      src={`${API_BASE_URL}/videos/${previewVideo}?token=${localStorage.getItem('token')}`} 
                      className="w-full h-full"
                      controls 
                      autoPlay 
                      controlsList="nodownload"
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
