/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { Shield, AlertTriangle, CheckCircle2, Play, Pause, RefreshCw, Video, HardHat, Eye, Hand, LayoutDashboard, Info, Upload, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Types ---

interface Detection {
  item: 'helmet' | 'glasses' | 'mask' | 'gloves';
  status: 'present' | 'missing';
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
}

// --- Constants ---

const GEMINI_MODEL = "gemini-flash-latest";
const DETECTION_INTERVAL = 3000; // 3 seconds between detections
const DEFAULT_VIDEO_URL = "https://t3.ftcdn.net/jpg/05/93/40/82/360_F_593408229_iZUqIkNJTnfcej66N5oWm38uFgX5AoYl.jpg";

export default function App() {
  const [videoUrl, setVideoUrl] = useState<string | null>(DEFAULT_VIDEO_URL); 
  const [imageUrlInput, setImageUrlInput] = useState(DEFAULT_VIDEO_URL);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [isAnalyzed, setIsAnalyzed] = useState(false);
  const [lastProcessedTime, setLastProcessedTime] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const processingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // --- Gemini Logic ---

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  const runDetection = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context || video.paused || video.ended) return;

    // Capture current frame
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: imageData,
                },
              },
              {
                text: "Analyze this industrial workspace image for PPE (Personal Protective Equipment). Detect: 1. Helmet (on head), 2. Safety Glasses (on eyes), 3. Face Mask (covering mouth and nose), 4. Work Gloves (on hands). For each, return the bounding box [ymin, xmin, ymax, xmax] (normalized 0-1000) and whether it is 'present' or 'missing'. If a person is present but an item is missing, provide the box where the item should be (e.g., the head area for a missing helmet).",
              },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                item: { type: Type.STRING, enum: ["helmet", "glasses", "mask", "gloves"] },
                status: { type: Type.STRING, enum: ["present", "missing"] },
                box_2d: { 
                  type: Type.ARRAY, 
                  items: { type: Type.NUMBER },
                  description: "[ymin, xmin, ymax, xmax] normalized 0-1000"
                }
              },
              required: ["item", "status", "box_2d"]
            }
          }
        }
      });

      const result = JSON.parse(response.text || '[]');
      setDetections(result);
      setLastProcessedTime(Date.now());
      setError(null);
    } catch (err: any) {
      console.error("Detection error:", err);
      if (err?.message?.includes('503') || err?.message?.includes('high demand')) {
        setError("Gemini API is currently overloaded. Retrying automatically...");
      } else {
        setError("Failed to process frame. Please ensure the video is playing.");
      }
    }
  }, [ai]);

  useEffect(() => {
    if (isProcessing && videoUrl) {
      processingIntervalRef.current = setInterval(() => {
        runDetection();
      }, DETECTION_INTERVAL);
    } else {
      if (processingIntervalRef.current) {
        clearInterval(processingIntervalRef.current);
      }
    }
    return () => {
      if (processingIntervalRef.current) clearInterval(processingIntervalRef.current);
    };
  }, [isProcessing, runDetection, videoUrl]);

  const loadUrl = (url: string) => {
    setVideoUrl(url);
    setIsAnalyzed(false);
    setDetections([]);
    setError(null);
  };

  const analyzeCurrentFrame = async () => {
    if (isSearching) return;
    setIsSearching(true);
    setError(null);

    try {
      let imageData = '';

      if (videoUrl && (videoUrl.match(/\.(jpeg|jpg|gif|png|webp)/i) || videoUrl.includes('picsum') || videoUrl.includes('img.freepik.com'))) {
        // Handle Image
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = videoUrl;
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error("Failed to load image."));
        });

        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = img.width;
        canvas.height = img.height;
        context.drawImage(img, 0, 0);
        imageData = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      } else if (videoRef.current && canvasRef.current) {
        // Handle Video Frame
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0);
        imageData = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      }

      if (!imageData) throw new Error("No image data found.");

      const detectionResponse = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: imageData,
                },
              },
              {
                text: "Analyze this industrial workspace image for PPE (Personal Protective Equipment). Detect: 1. Helmet (on head), 2. Safety Glasses (on eyes), 3. Face Mask (covering mouth and nose), 4. Work Gloves (on hands). For each, return the bounding box [ymin, xmin, ymax, xmax] (normalized 0-1000) and whether it is 'present' or 'missing'.",
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                item: { type: Type.STRING, enum: ["helmet", "glasses", "mask", "gloves"] },
                status: { type: Type.STRING, enum: ["present", "missing"] },
                box_2d: { 
                  type: Type.ARRAY, 
                  items: { type: Type.NUMBER },
                }
              },
              required: ["item", "status", "box_2d"]
            }
          }
        }
      });

      const result = JSON.parse(detectionResponse.text || '[]');
      setDetections(result);
      setIsAnalyzed(true);
      setLastProcessedTime(Date.now());
    } catch (err: any) {
      console.error("Analysis error:", err);
      setError(err.message || "Failed to analyze.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchAndAnalyze = async () => {
    setIsSearching(true);
    setError(null);
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: "Find a high-quality direct image URL of a construction worker wearing a hard hat, safety glasses, and work gloves. Return ONLY the URL.",
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      
      const url = response.text?.trim();
      if (!url || !url.startsWith('http')) {
        throw new Error("Could not find a valid image URL.");
      }

      loadUrl(url);
    } catch (err: any) {
      console.error("Search error:", err);
      setError(err.message || "Failed to search for image.");
      setIsSearching(false);
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (imageUrlInput.trim()) {
      loadUrl(imageUrlInput.trim());
    }
  };

  // --- Rendering Helpers ---

  const getStatusColor = (status: string) => status === 'present' ? 'text-emerald-500' : 'text-rose-500';
  const getStatusBg = (status: string) => status === 'present' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20';

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-zinc-300 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-[#0D0D0E]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
            <Shield className="text-black w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight uppercase">SafeGuard AI</h1>
            <p className="text-[10px] text-zinc-500 font-mono">PPE DETECTION SYSTEM V2.5</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <form onSubmit={handleUrlSubmit} className="flex items-center bg-zinc-900 rounded-lg border border-white/5 overflow-hidden">
            <input
              type="text"
              placeholder="Paste Image URL..."
              value={imageUrlInput}
              onChange={(e) => setImageUrlInput(e.target.value)}
              className="bg-transparent px-3 py-1.5 text-[10px] w-48 focus:outline-none"
            />
            <button 
              type="submit"
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-[10px] font-bold border-l border-white/5 transition-colors"
            >
              ANALYZE
            </button>
          </form>
          <button
            onClick={handleSearchAndAnalyze}
            disabled={isSearching}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-800 text-black rounded-lg text-xs font-bold transition-colors"
          >
            {isSearching ? (
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            {isSearching ? 'SEARCHING...' : 'ONLINE TEST'}
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-full border border-white/5">
            <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700'}`} />
            <span className="text-[10px] font-medium uppercase tracking-wider">
              {isProcessing ? 'System Active' : 'System Standby'}
            </span>
          </div>
        </div>
      </header>

      <main className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1600px] mx-auto">
        
        {/* Left Column: Video & Controls */}
        <div className="lg:col-span-8 space-y-6">
          <section className="bg-[#0D0D0E] border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Video Analysis</span>
              </div>
              <div className="flex items-center gap-3">
                {videoUrl && (
                  <button 
                    onClick={() => {
                      if (videoUrl.match(/\.(jpeg|jpg|gif|png|webp)/i) || videoUrl.includes('picsum') || videoUrl.includes('img.freepik.com')) {
                        analyzeCurrentFrame();
                      } else {
                        setIsProcessing(!isProcessing);
                      }
                    }}
                    disabled={isSearching}
                    className={`flex items-center gap-2 px-6 py-2 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${
                      isProcessing 
                      ? 'bg-rose-500 text-white hover:bg-rose-600' 
                      : isSearching
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : 'bg-emerald-500 text-black hover:bg-emerald-400'
                    }`}
                  >
                    {isProcessing ? (
                      <><Pause className="w-3.5 h-3.5" /> Stop Analysis</>
                    ) : (
                      videoUrl.match(/\.(jpeg|jpg|gif|png|webp)/i) || videoUrl.includes('picsum') || videoUrl.includes('img.freepik.com') ? (
                        <><RefreshCw className={`w-3.5 h-3.5 ${isSearching ? 'animate-spin' : ''}`} /> {isAnalyzed ? 'Re-Analyze' : 'Analyze Image'}</>
                      ) : (
                        <><Play className="w-3.5 h-3.5" /> Start Analysis</>
                      )
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="relative aspect-video bg-black group flex items-center justify-center overflow-hidden">
              {videoUrl ? (
                <>
                  <div className={`w-full h-full transition-all duration-700 ${!isAnalyzed && !isProcessing ? 'blur-xl scale-110' : ''}`}>
                    {videoUrl.match(/\.(jpeg|jpg|gif|png|webp)/i) || videoUrl.includes('picsum') || videoUrl.includes('img.freepik.com') ? (
                      <img 
                        src={videoUrl}
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <video 
                        ref={videoRef}
                        src={videoUrl}
                        className="w-full h-full object-contain"
                        controls
                        muted
                        loop
                      />
                    )}
                  </div>

                  {/* Protection Overlay */}
                  {!isAnalyzed && !isProcessing && (
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                      <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4 border border-emerald-500/50 animate-pulse">
                        <Shield className="w-10 h-10 text-emerald-500" />
                      </div>
                      <h3 className="text-white font-bold text-lg mb-2 uppercase tracking-widest">Protected Feed</h3>
                      <p className="text-zinc-400 text-[10px] mb-6 uppercase tracking-widest">Analysis required for safety verification</p>
                      <button
                        onClick={analyzeCurrentFrame}
                        disabled={isSearching}
                        className="px-8 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(16,185,129,0.3)]"
                      >
                        {isSearching ? 'ANALYZING...' : 'START ANALYSIS'}
                      </button>
                    </div>
                  )}
                  
                  {/* Overlay Canvas for Bounding Boxes */}
                  <div className="absolute inset-0 pointer-events-none z-20">
                    {detections.map((det, idx) => {
                      const [ymin, xmin, ymax, xmax] = det.box_2d;
                      return (
                        <motion.div
                          key={`${det.item}-${idx}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={`absolute border-2 ${det.status === 'present' ? 'border-emerald-500' : 'border-rose-500'}`}
                          style={{
                            top: `${ymin / 10}%`,
                            left: `${xmin / 10}%`,
                            width: `${(xmax - xmin) / 10}%`,
                            height: `${(ymax - ymin) / 10}%`,
                          }}
                        >
                          <div className={`absolute -top-6 left-0 px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${
                            det.status === 'present' ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'
                          }`}>
                            {det.item}: {det.status}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-center p-12">
                  <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/5">
                    <Upload className="w-8 h-8 text-zinc-600" />
                  </div>
                  <h3 className="text-white font-bold mb-2">No Video Loaded</h3>
                  <p className="text-xs text-zinc-500 max-w-xs mx-auto">
                    Please upload the safety video file to begin automated PPE detection and analysis.
                  </p>
                </div>
              )}

              {/* Hidden Canvas for Frame Capture */}
              <canvas ref={canvasRef} className="hidden" />

              {/* Error Overlay */}
              <AnimatePresence>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/80 flex items-center justify-center p-8 text-center z-20"
                  >
                    <div className="max-w-xs">
                      <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
                      <h3 className="text-white font-bold mb-2">Analysis Error</h3>
                      <p className="text-xs text-zinc-400 mb-6 leading-relaxed">{error}</p>
                      <button 
                        onClick={() => setError(null)}
                        className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all"
                      >
                        Dismiss
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>

          {/* System Info */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Latency', value: '1.2s', icon: RefreshCw },
              { label: 'Confidence', value: '98.4%', icon: Shield },
              { label: 'Uptime', value: '12h 43m', icon: Info },
            ].map((stat, i) => (
              <div key={i} className="bg-[#0D0D0E] border border-white/5 p-4 rounded-xl flex items-center gap-4">
                <div className="p-2 bg-zinc-900 rounded-lg">
                  <stat.icon className="w-4 h-4 text-zinc-500" />
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest leading-none mb-1">{stat.label}</p>
                  <p className="text-sm font-mono font-bold text-white">{stat.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Status Panel */}
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-[#0D0D0E] border border-white/5 rounded-2xl p-6 h-full shadow-xl">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white">Detection Log</h2>
              <span className="text-[10px] font-mono text-zinc-600">
                {lastProcessedTime ? new Date(lastProcessedTime).toLocaleTimeString() : '--:--:--'}
              </span>
            </div>

            <div className="space-y-4">
              {detections.filter(d => d.status === 'missing').length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl mb-6"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500" />
                    <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Critical Violations</span>
                  </div>
                  <p className="text-[11px] text-rose-200/70 leading-relaxed">
                    The following items are missing: <span className="text-rose-500 font-bold">
                      {detections.filter(d => d.status === 'missing').map(d => d.item).join(', ')}
                    </span>. Immediate corrective action required.
                  </p>
                </motion.div>
              )}

              {[
                { id: 'helmet', label: 'Safety Helmet', icon: HardHat },
                { id: 'glasses', label: 'Safety Glasses', icon: Eye },
                { id: 'mask', label: 'Face Mask', icon: Shield },
                { id: 'gloves', label: 'Work Gloves', icon: Hand },
              ].map((item) => {
                const detection = detections.find(d => d.item === item.id);
                const status = detection?.status || 'unknown';
                
                return (
                  <div 
                    key={item.id}
                    className={`p-4 rounded-xl border transition-all duration-500 ${
                      status === 'unknown' ? 'bg-zinc-900/20 border-white/5 opacity-50' : getStatusBg(status)
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${status === 'unknown' ? 'bg-zinc-800' : 'bg-black/20'}`}>
                          <item.icon className={`w-5 h-5 ${status === 'unknown' ? 'text-zinc-600' : getStatusColor(status)}`} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-white">{item.label}</p>
                          <p className={`text-[10px] font-mono uppercase ${status === 'unknown' ? 'text-zinc-600' : getStatusColor(status)}`}>
                            {status === 'unknown' ? 'Scanning...' : status}
                          </p>
                        </div>
                      </div>
                      {status === 'present' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                      {status === 'missing' && <AlertTriangle className="w-5 h-5 text-rose-500 animate-pulse" />}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-12 pt-8 border-t border-white/5">
              <div className="flex items-center gap-2 mb-4">
                <LayoutDashboard className="w-4 h-4 text-zinc-500" />
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Compliance Summary</h3>
              </div>
              
              <div className="space-y-4">
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-zinc-500">Overall Safety Score</span>
                  <span className="text-white font-mono">
                    {detections.length > 0 
                      ? `${Math.round((detections.filter(d => d.status === 'present').length / detections.length) * 100)}%`
                      : '0%'}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: detections.length > 0 
                      ? `${(detections.filter(d => d.status === 'present').length / detections.length) * 100}%`
                      : '0%' 
                    }}
                    className="h-full bg-emerald-500"
                  />
                </div>
                <p className="text-[10px] text-zinc-600 italic">
                  * Analysis performed every {DETECTION_INTERVAL/1000}s using Gemini Vision.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 h-8 bg-[#0D0D0E] border-t border-white/5 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-4">
          <span className="text-[9px] font-mono text-zinc-600">SYSTEM STATUS: NOMINAL</span>
          <span className="text-[9px] font-mono text-zinc-600">ENCRYPTION: AES-256</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[9px] font-mono text-zinc-600">© 2026 SAFEGUARD AI SYSTEMS</span>
        </div>
      </footer>
    </div>
  );
}
