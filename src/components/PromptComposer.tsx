import React, { useRef } from 'react';
import {
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Plus,
  SendHorizontal,
  Video,
  X,
} from 'lucide-react';
import type { ChatMode, UploadedAttachment } from '../types/chat';

interface PromptComposerProps {
  prompt: string;
  mode: ChatMode;
  webSearchEnabled: boolean;
  attachment: UploadedAttachment | null;
  uploadingFile: boolean;
  generating: boolean;
  onPromptChange: (value: string) => void;
  onModeChange: (mode: ChatMode) => void;
  onToggleWebSearch: () => void;
  onFileSelected: (file: File) => void;
  onRemoveAttachment: () => void;
  onSubmit: () => void;
}

export const PromptComposer: React.FC<PromptComposerProps> = ({
  prompt,
  mode,
  webSearchEnabled,
  attachment,
  uploadingFile,
  generating,
  onPromptChange,
  onModeChange,
  onToggleWebSearch,
  onFileSelected,
  onRemoveAttachment,
  onSubmit,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canSend = !generating && !uploadingFile && (prompt.trim().length > 0 || attachment !== null);

  const placeholder =
    mode === 'image'
      ? 'Describe the image you want SARTHI AI to create...'
      : mode === 'video'
        ? 'Describe the video scene you want SARTHI AI to generate...'
        : 'Ask SARTHI AI in English, Hindi, or Hinglish...';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        onSubmit();
      }
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-3 sm:px-4 pb-4 pt-2">
      {/* Attachment Preview Strip */}
      {attachment && (
        <div className="mb-2.5 flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#161b22] p-2.5">
          {attachment.kind === 'image' && (attachment.previewDataUrl || attachment.dataUrl) ? (
            <img
              src={attachment.previewDataUrl || attachment.dataUrl}
              alt={attachment.name}
              className="w-12 h-12 rounded-xl object-cover border border-slate-200 dark:border-white/10 shrink-0"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
              {attachment.name}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {attachment.kind === 'image'
                ? `Image · ${(attachment.size / 1024).toFixed(0)} KB`
                : `Document · ${(attachment.charCount || 0).toLocaleString()} chars extracted`}
            </p>
          </div>

          <button
            type="button"
            onClick={onRemoveAttachment}
            aria-label="Remove attachment"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Composer Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#161b22] focus-within:border-blue-500 dark:focus-within:border-blue-400/70 transition-colors">
        <textarea
          rows={1}
          value={prompt}
          onChange={(e) => {
            onPromptChange(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 168)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none max-h-[168px]"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* + Upload File Button */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.docx,image/jpeg,image/png,image/webp,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onFileSelected(file);
                }
                e.target.value = '';
              }}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFile || generating}
              title="Upload image (JPG, PNG, WebP) or document (PDF, TXT, DOCX)"
              aria-label="Upload image or document"
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1117] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
            >
              {uploadingFile ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </button>

            {/* Mode Selector Pills */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-[#0e1117] border border-slate-200/70 dark:border-white/10">
              <button
                type="button"
                onClick={() => onModeChange('chat')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'chat'
                    ? 'bg-white dark:bg-[#1f2633] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat</span>
              </button>

              <button
                type="button"
                onClick={() => onModeChange('image')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'image'
                    ? 'bg-white dark:bg-[#1f2633] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Create Image</span>
              </button>

              <button
                type="button"
                onClick={() => onModeChange('video')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'video'
                    ? 'bg-white dark:bg-[#1f2633] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>Create Video</span>
              </button>
            </div>

            {/* Live Web Search Toggle in Chat Mode */}
            {mode === 'chat' && (
              <button
                type="button"
                onClick={onToggleWebSearch}
                title="Automatic live internet search"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  webSearchEnabled
                    ? 'border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                    : 'border-slate-200 dark:border-white/10 bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Live Search</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label="Send message"
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:hover:bg-blue-600 transition-colors shrink-0 cursor-pointer"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <SendHorizontal className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
