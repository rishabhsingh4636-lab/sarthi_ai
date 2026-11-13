import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Pause,
  Play,
  Square,
  Volume2,
} from 'lucide-react';
import type { ChatMessage } from '../types/chat';
import {
  detectSpeechLang,
  getSortedSpeechVoices,
  pickVoiceForLang,
  stripMarkdownForSpeech,
} from '../utils/tts';

interface MessageBubbleProps {
  message: ChatMessage;
  activeSpeechMessageId: string | null;
  speechStatus: 'idle' | 'playing' | 'paused';
  selectedVoiceURI: string;
  onStartSpeech: (message: ChatMessage, voiceURI?: string) => void;
  onPauseResumeSpeech: () => void;
  onStopSpeech: () => void;
  onSelectVoice: (voiceURI: string, message: ChatMessage) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  activeSpeechMessageId,
  speechStatus,
  selectedVoiceURI,
  onStartSpeech,
  onPauseResumeSpeech,
  onStopSpeech,
  onSelectVoice,
}) => {
  const [copied, setCopied] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [mediaLoadError, setMediaLoadError] = useState(false);
  const [downloadingMedia, setDownloadingMedia] = useState(false);
  const [downloadedMedia, setDownloadedMedia] = useState(false);

  const isUser = message.role === 'user';
  const isSpeakingThis = activeSpeechMessageId === message.id && speechStatus !== 'idle';
  const detectedLang = detectSpeechLang(message.content);

  useEffect(() => {
    if (isUser || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const syncVoices = () => setVoices(getSortedSpeechVoices());
    syncVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', syncVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', syncVoices);
    };
  }, [isUser]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  };

  const handleDownloadImage = async () => {
    if (!message.mediaUrl || downloadingMedia) return;
    setDownloadingMedia(true);
    try {
      const response = await fetch(message.mediaUrl, { credentials: 'omit' });
      if (!response.ok) throw new Error('Download failed');
      const rawBlob = await response.blob();
      const rawUrl = URL.createObjectURL(rawBlob);

      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Image decode failed'));
          el.src = rawUrl;
        });

        const natW = img.naturalWidth || 1024;
        const natH = img.naturalHeight || 1024;
        // Generated images request extra height (~1120 vs 1024) so taking the top square
        // removes any bottom-corner upstream mark completely. If square, trim the bottom 9%.
        const cropSize = natH > natW ? natW : Math.round(natH * 0.91);
        const sx = Math.max(0, Math.round((natW - cropSize) / 2));
        const sy = 0;

        const targetSize = Math.max(1024, cropSize);
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable');

        ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, targetSize, targetSize);

        // Bake clean opaque SARTHI AI brand badge in the bottom-right corner
        const scale = Math.max(0.75, canvas.width / 1024);
        const fontSize = Math.round(18 * scale);
        ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
        const label = 'SARTHI AI';
        const textMetrics = ctx.measureText(label);
        const padX = Math.round(14 * scale);
        const padY = Math.round(8 * scale);
        const margin = Math.round(20 * scale);
        const badgeW = textMetrics.width + padX * 2;
        const badgeH = fontSize + padY * 2;
        const bx = canvas.width - badgeW - margin;
        const by = canvas.height - badgeH - margin;
        const radius = Math.round(8 * scale);

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(bx, by, badgeW, badgeH, radius);
        ctx.fillStyle = 'rgba(10, 14, 23, 0.96)';
        ctx.fill();
        ctx.lineWidth = Math.max(1, scale);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + padX, by + badgeH / 2 + 1);
        ctx.restore();

        const watermarkedBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Blob export failed'))),
            'image/jpeg',
            0.94,
          );
        });
        triggerBlobDownload(watermarkedBlob, `sarthi-ai-${message.id.slice(0, 8)}.jpg`);
      } catch {
        triggerBlobDownload(rawBlob, `sarthi-ai-${message.id.slice(0, 8)}.jpg`);
      } finally {
        URL.revokeObjectURL(rawUrl);
      }

      setDownloadedMedia(true);
      setTimeout(() => setDownloadedMedia(false), 2000);
    } catch {
      // Silent fallback if media expired
    } finally {
      setDownloadingMedia(false);
    }
  };

  const handleDownloadVideo = async () => {
    if (!message.mediaUrl || downloadingMedia) return;
    setDownloadingMedia(true);
    try {
      const response = await fetch(message.mediaUrl, { credentials: 'omit' });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      triggerBlobDownload(blob, `sarthi-ai-video-${message.id.slice(0, 8)}.mp4`);
      setDownloadedMedia(true);
      setTimeout(() => setDownloadedMedia(false), 2000);
    } catch {
      // Ignore transient download failure
    } finally {
      setDownloadingMedia(false);
    }
  };

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl bg-slate-100 dark:bg-[#1c2330] border border-slate-200/80 dark:border-white/10 px-4 py-3 text-[15px] text-slate-900 dark:text-slate-100">
          {message.mediaType === 'image' && message.mediaUrl && (
            <div className="mb-2.5 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
              <img
                src={message.mediaUrl}
                alt={message.attachmentName || 'Uploaded image'}
                className="max-h-64 w-auto object-contain bg-black/5 dark:bg-black/30"
                referrerPolicy="no-referrer"
              />
            </div>
          )}

          {message.mediaType === 'document' && message.attachmentName && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/15 bg-white dark:bg-[#0e1117] px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300">
              <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="truncate max-w-[220px]">{message.attachmentName}</span>
            </div>
          )}

          {message.content && (
            <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
          )}
        </div>
      </div>
    );
  }

  const activeVoice = pickVoiceForLang(voices, detectedLang, selectedVoiceURI);

  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <img
        src="/logo.png"
        alt="SARTHI AI"
        className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-white/15 shrink-0 mt-0.5"
        referrerPolicy="no-referrer"
      />

      <div className="flex-1 min-w-0 space-y-3">
        {/* Generated Image */}
        {message.mediaType === 'image' && message.mediaUrl && (
          <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#161b22] max-w-lg">
            {!mediaLoadError ? (
              <div className="relative aspect-square w-full overflow-hidden bg-slate-100 dark:bg-black/40">
                <img
                  src={message.mediaUrl}
                  alt={message.content || 'Generated image'}
                  onError={() => setMediaLoadError(true)}
                  className="w-full h-full object-cover object-top"
                  referrerPolicy="no-referrer"
                />
                <div className="pointer-events-none select-none absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-md bg-slate-950/95 border border-white/25 px-2.5 py-1 shadow-xs">
                  <img
                    src="/logo.png"
                    alt=""
                    className="w-3.5 h-3.5 rounded-xs object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <span className="font-display text-[11px] font-bold tracking-wider text-white whitespace-nowrap">
                    SARTHI AI
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Image preview expired from temporary media storage. Generate again anytime.
              </div>
            )}
            <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-slate-200 dark:border-white/10 text-xs">
              <span className="text-slate-500 dark:text-slate-400 truncate">
                SARTHI AI · 1024×1024
              </span>
              <button
                type="button"
                onClick={() => void handleDownloadImage()}
                disabled={downloadingMedia || mediaLoadError}
                className="inline-flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {downloadingMedia ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : downloadedMedia ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>{downloadedMedia ? 'Saved' : 'Download'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Generated Video */}
        {message.mediaType === 'video' && message.mediaUrl && (
          <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#161b22] max-w-lg">
            {!mediaLoadError ? (
              <video
                src={message.mediaUrl}
                controls
                playsInline
                preload="metadata"
                onError={() => setMediaLoadError(true)}
                className="w-full max-h-[420px] bg-black"
              />
            ) : (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Video file expired from temporary media storage. Generate again anytime.
              </div>
            )}
            <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-slate-200 dark:border-white/10 text-xs">
              <span className="text-slate-500 dark:text-slate-400 truncate">
                AI Video Clip
              </span>
              <button
                type="button"
                onClick={() => void handleDownloadVideo()}
                disabled={downloadingMedia || mediaLoadError}
                className="inline-flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {downloadingMedia ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : downloadedMedia ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>{downloadedMedia ? 'Saved' : 'Download MP4'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Markdown Text */}
        {message.content && (
          <div className="sarthi-markdown break-words">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node: _node, ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" />
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Live Web Search Sources */}
        {message.sources && message.sources.length > 0 && (
          <div className="pt-2 border-t border-slate-200/80 dark:border-white/10">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
              <Globe className="w-3.5 h-3.5" />
              <span>Live Web Sources</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {message.sources.map((src, idx) => (
                <a
                  key={`${src.url}-${idx}`}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline max-w-[260px]"
                >
                  <span className="tabular-nums text-slate-400">{idx + 1}.</span>
                  <span className="truncate">{src.title}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Assistant Message Action Bar (Speaker Auto-TTS & Copy) */}
        {message.content && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!isSpeakingThis ? (
              <button
                type="button"
                onClick={() => onStartSpeech(message)}
                title={`Read aloud (${detectedLang === 'hi-IN' ? 'Hindi' : 'English'})`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Listen</span>
                <span className="text-slate-400 dark:text-slate-500">
                  · {detectedLang === 'hi-IN' ? 'हिन्दी' : 'EN'}
                </span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/70 dark:bg-blue-950/30 px-2.5 py-1">
                <button
                  type="button"
                  onClick={onPauseResumeSpeech}
                  aria-label={speechStatus === 'playing' ? 'Pause speech' : 'Resume speech'}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 cursor-pointer"
                >
                  {speechStatus === 'playing' ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>Resume</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onStopSpeech}
                  aria-label="Stop speech"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-white/10 cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </button>

                {voices.length > 0 && (
                  <select
                    aria-label="Select text-to-speech voice"
                    value={activeVoice?.voiceURI || ''}
                    onChange={(e) => onSelectVoice(e.target.value, message)}
                    className="max-w-[175px] truncate bg-white dark:bg-[#0e1117] border border-slate-200 dark:border-white/15 rounded-lg px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200 focus:outline-none"
                  >
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy response"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export { stripMarkdownForSpeech };
