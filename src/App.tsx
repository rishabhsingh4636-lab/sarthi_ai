import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  AlertCircle,
  Globe,
  Image as ImageIcon,
  Languages,
  Loader2,
  Menu,
  Moon,
  PanelLeftOpen,
  Plus,
  Sun,
  Video,
  X,
} from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { MessageBubble, stripMarkdownForSpeech } from './components/MessageBubble';
import { PromptComposer } from './components/PromptComposer';
import { Sidebar } from './components/Sidebar';
import { auth } from './lib/firebase';
import {
  createChatSession,
  deleteChatSession,
  saveMessageToChat,
  subscribeToChatMessages,
  subscribeToUserChats,
  touchChatSession,
  updateUserTheme,
  upsertUserProfile,
} from './services/chatStorage';
import type {
  ChatMessage,
  ChatMode,
  ChatSession,
  UploadedAttachment,
  WebSource,
} from './types/chat';
import { createCompactImageThumbnail } from './utils/imageResize';
import { detectSpeechLang, getSortedSpeechVoices, pickVoiceForLang } from './utils/tts';

interface SuggestionChip {
  label: string;
  sublabel: string;
  prompt: string;
  mode: ChatMode;
  icon: 'globe' | 'hindi' | 'image' | 'video';
}

const SUGGESTION_CHIPS: SuggestionChip[] = [
  {
    label: 'आज की ताज़ा खबरें और मौसम',
    sublabel: 'Live Hindi search & Devanagari reply',
    prompt: 'आज दिल्ली का मौसम कैसा है और भारत की प्रमुख ताज़ा खबरें बताओ?',
    mode: 'chat',
    icon: 'globe',
  },
  {
    label: 'Explain in simple Hindi',
    sublabel: 'Hinglish or English to clean Hindi',
    prompt: 'Mujhe AI aur Machine Learning ka difference simple Hindi mein samjhao.',
    mode: 'chat',
    icon: 'hindi',
  },
  {
    label: 'Create an AI Image',
    sublabel: 'Generate free unlimited AI art',
    prompt: 'A serene golden hour view of Varanasi ghats with glowing diyas reflecting on the Ganga river, photorealistic, 8k',
    mode: 'image',
    icon: 'image',
  },
  {
    label: 'Create an AI Video',
    sublabel: 'Text-to-video short clip',
    prompt: 'A futuristic bullet train gliding through misty green Himalayan mountains at sunrise',
    mode: 'video',
    icon: 'video',
  },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('sarthi-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'dark';
  });

  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<ChatMode>('chat');
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [sidebarDesktopCollapsed, setSidebarDesktopCollapsed] = useState(false);

  // Text-to-Speech state
  const [activeSpeechMessageId, setActiveSpeechMessageId] = useState<string | null>(null);
  const [speechStatus, setSpeechStatus] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('');

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Sync Tailwind dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem('sarthi-theme', theme);
  }, [theme]);

  // Stop speech when unmounting or switching chats
  const stopSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setActiveSpeechMessageId(null);
    setSpeechStatus('idle');
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Auth listener & profile hydration
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);

      if (currentUser) {
        void upsertUserProfile(currentUser, theme)
          .then((profile) => {
            if (profile.preferredTheme === 'light' || profile.preferredTheme === 'dark') {
              setTheme(profile.preferredTheme);
            }
          })
          .catch((err) => {
            console.error('Failed to sync user profile:', err);
          });
      } else {
        setChats([]);
        setMessages([]);
        setActiveChatId(null);
        stopSpeech();
      }
    });

    return () => unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to logged-in user's chat sessions
  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToUserChats(user.uid, (userChats) => {
      setChats(userChats);
    });
    return () => unsubscribe();
  }, [user]);

  // Subscribe to messages for the active chat
  useEffect(() => {
    if (!user || !activeChatId) {
      setMessages([]);
      return;
    }
    const unsubscribe = subscribeToChatMessages(activeChatId, user.uid, (chatMessages) => {
      setMessages(chatMessages);
    });
    return () => unsubscribe();
  }, [user, activeChatId]);

  // Smooth scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, generating]);

  const handleToggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (user) {
      void updateUserTheme(user.uid, next).catch((err) => console.error(err));
    }
  };

  const handleNewChat = () => {
    stopSpeech();
    setActiveChatId(null);
    setMessages([]);
    setAttachment(null);
    setErrorBanner(null);
    setMode('chat');
  };

  const handleSelectChat = (chatId: string) => {
    stopSpeech();
    setActiveChatId(chatId);
    setErrorBanner(null);
  };

  const handleDeleteChat = async (chatId: string) => {
    if (!user) return;
    if (activeChatId === chatId) {
      handleNewChat();
    }
    try {
      await deleteChatSession(chatId, user.uid);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to delete conversation.');
    }
  };

  const handleSignOut = async () => {
    stopSpeech();
    await signOut(auth);
  };

  async function safeParseJson<T>(res: Response): Promise<T> {
    const rawText = await res.text();
    try {
      return JSON.parse(rawText) as T;
    } catch {
      const trimmed = rawText.trim();
      if (trimmed.startsWith('<')) {
        throw new Error(
          `Server returned an HTML error page (HTTP ${res.status}). The request may have timed out or the server is restarting—please try again.`,
        );
      }
      throw new Error(trimmed.slice(0, 200) || `Unexpected server response (HTTP ${res.status}).`);
    }
  }

  const handleFileSelected = async (file: File) => {
    setErrorBanner(null);
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await safeParseJson<UploadedAttachment & { error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload file.');
      }

      if (data.kind === 'image' && data.dataUrl) {
        const compactPreview = await createCompactImageThumbnail(data.dataUrl);
        setAttachment({
          ...data,
          previewDataUrl: compactPreview || data.dataUrl,
        });
        setMode('chat');
      } else {
        setAttachment(data);
        setMode('chat');
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'File upload failed.');
    } finally {
      setUploadingFile(false);
    }
  };

  // Auto-detect TTS playback controls
  const startSpeech = (message: ChatMessage, overrideVoiceURI?: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setErrorBanner('Text-to-Speech is not supported in this browser.');
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = stripMarkdownForSpeech(message.content);
    if (!cleanText) return;

    const lang = detectSpeechLang(message.content);
    const voices = getSortedSpeechVoices();
    const chosenVoice = pickVoiceForLang(voices, lang, overrideVoiceURI || selectedVoiceURI);

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = chosenVoice?.lang || lang;
    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }
    utterance.rate = 1.0;

    utterance.onstart = () => {
      setActiveSpeechMessageId(message.id);
      setSpeechStatus('playing');
    };
    utterance.onpause = () => setSpeechStatus('paused');
    utterance.onresume = () => setSpeechStatus('playing');
    utterance.onend = () => {
      setActiveSpeechMessageId(null);
      setSpeechStatus('idle');
    };
    utterance.onerror = () => {
      setActiveSpeechMessageId(null);
      setSpeechStatus('idle');
    };

    setActiveSpeechMessageId(message.id);
    setSpeechStatus('playing');
    window.speechSynthesis.speak(utterance);
  };

  const handlePauseResumeSpeech = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speechStatus === 'playing') {
      window.speechSynthesis.pause();
      setSpeechStatus('paused');
    } else if (speechStatus === 'paused') {
      window.speechSynthesis.resume();
      setSpeechStatus('playing');
    }
  };

  const handleSelectVoice = (voiceURI: string, message: ChatMessage) => {
    setSelectedVoiceURI(voiceURI);
    startSpeech(message, voiceURI);
  };

  const submitPrompt = async (overrideText?: string, overrideMode?: ChatMode) => {
    if (!user || generating || uploadingFile) return;

    const currentMode = overrideMode ?? mode;
    const textToSend = (overrideText ?? prompt).trim();
    const currentAttachment = attachment;

    if (!textToSend && !currentAttachment) return;

    setErrorBanner(null);
    setPrompt('');
    setAttachment(null);
    setGenerating(true);

    const stageLabel =
      currentMode === 'image'
        ? 'Creating image with Pollinations.ai...'
        : currentMode === 'video'
          ? 'Checking video generation service...'
          : currentAttachment?.kind === 'image'
            ? 'Analyzing image with Groq Vision...'
            : webSearchEnabled
              ? 'Searching live web and thinking...'
              : 'Thinking...';
    setLoadingStage(stageLabel);

    let targetChatId = activeChatId;
    const isNewChat = !targetChatId;

    try {
      const chatTitle =
        textToSend ||
        (currentAttachment ? `Analysis: ${currentAttachment.name}` : 'New Chat');

      if (!targetChatId) {
        targetChatId = crypto.randomUUID();
        setActiveChatId(targetChatId);
        await createChatSession(targetChatId, user.uid, chatTitle, currentMode);
      } else {
        await touchChatSession(targetChatId, currentMode);
      }

      const userMsgId = crypto.randomUUID();
      await saveMessageToChat({
        chatId: targetChatId,
        messageId: userMsgId,
        userId: user.uid,
        role: 'user',
        mode: currentMode,
        content:
          textToSend ||
          (currentAttachment?.kind === 'image'
            ? 'Analyze this uploaded image.'
            : `Summarize ${currentAttachment?.name || 'document'}.`),
        mediaType:
          currentAttachment?.kind === 'image'
            ? 'image'
            : currentAttachment?.kind === 'document'
              ? 'document'
              : 'none',
        mediaUrl:
          currentAttachment?.kind === 'image'
            ? currentAttachment.previewDataUrl
            : undefined,
        attachmentName: currentAttachment?.name,
      });

      if (currentMode === 'image') {
        const res = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: textToSend }),
        });
        const data = await safeParseJson<{
          imageUrl?: string;
          model?: string;
          enhancedPrompt?: string;
          translated?: boolean;
          error?: string;
        }>(res);
        if (!res.ok || !data.imageUrl) {
          throw new Error(data.error || 'Image generation failed.');
        }

        const imageCaption =
          data.translated && data.enhancedPrompt
            ? `**"${textToSend}"** के लिए तस्वीर तैयार है।\n\n*Enhanced visual prompt:* ${data.enhancedPrompt}`
            : `Generated image for: "${textToSend}"`;

        await saveMessageToChat({
          chatId: targetChatId,
          messageId: crypto.randomUUID(),
          userId: user.uid,
          role: 'assistant',
          mode: 'image',
          content: imageCaption,
          mediaType: 'image',
          mediaUrl: data.imageUrl,
          language: data.translated ? 'hi' : 'en',
        });
      } else if (currentMode === 'video') {
        const res = await fetch('/api/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: textToSend }),
        });
        const data = await safeParseJson<{
          videoUrl?: string;
          unavailable?: boolean;
          message?: string;
          language?: 'hi' | 'en';
          model?: string;
          error?: string;
        }>(res);
        if (!res.ok) {
          throw new Error(data.error || 'Video generation failed.');
        }

        if (data.unavailable || !data.videoUrl) {
          await saveMessageToChat({
            chatId: targetChatId,
            messageId: crypto.randomUUID(),
            userId: user.uid,
            role: 'assistant',
            mode: 'video',
            content:
              data.message ||
              'Free video generation credits are currently unavailable. You can use Create Image for free unlimited artwork!',
            mediaType: 'none',
            language: data.language || 'en',
          });
        } else {
          await saveMessageToChat({
            chatId: targetChatId,
            messageId: crypto.randomUUID(),
            userId: user.uid,
            role: 'assistant',
            mode: 'video',
            content: `Generated video for: "${textToSend}"`,
            mediaType: 'video',
            mediaUrl: data.videoUrl,
            language: 'en',
          });
        }
      } else {
        const historyPayload = (isNewChat ? [] : messages)
          .slice(-8)
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: textToSend,
            history: historyPayload,
            imageDataUrl:
              currentAttachment?.kind === 'image' ? currentAttachment.dataUrl : undefined,
            documentText:
              currentAttachment?.kind === 'document'
                ? currentAttachment.extractedText
                : undefined,
            documentName:
              currentAttachment?.kind === 'document' ? currentAttachment.name : undefined,
            enableWebSearch: webSearchEnabled,
          }),
        });

        const data = await safeParseJson<{
          reply?: string;
          language?: 'hi' | 'en';
          sources?: WebSource[];
          error?: string;
        }>(res);

        if (!res.ok || !data.reply) {
          throw new Error(data.error || 'Failed to get response from SARTHI AI.');
        }

        await saveMessageToChat({
          chatId: targetChatId,
          messageId: crypto.randomUUID(),
          userId: user.uid,
          role: 'assistant',
          mode: 'chat',
          content: data.reply,
          mediaType: 'none',
          sources: data.sources,
          language: data.language || 'auto',
        });
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setGenerating(false);
      setLoadingStage('');
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0e1117] text-slate-600 dark:text-slate-300">
        <div className="flex items-center gap-3 text-sm font-medium">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <span>Loading SARTHI AI...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen theme={theme} onToggleTheme={handleToggleTheme} />;
  }

  const activeChat = chats.find((c) => c.id === activeChatId) || null;
  const firstName = (user.displayName || user.email?.split('@')[0] || 'Friend').split(' ')[0];

  return (
    <div className="h-screen flex overflow-hidden bg-white dark:bg-[#0e1117] text-slate-900 dark:text-slate-100">
      <Sidebar
        user={user}
        chats={chats}
        activeChatId={activeChatId}
        isOpenMobile={sidebarMobileOpen}
        isCollapsedDesktop={sidebarDesktopCollapsed}
        theme={theme}
        onCloseMobile={() => setSidebarMobileOpen(false)}
        onToggleCollapseDesktop={() => setSidebarDesktopCollapsed((prev) => !prev)}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onToggleTheme={handleToggleTheme}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Top Bar */}
        <header className="h-14 shrink-0 flex items-center justify-between gap-4 px-4 sm:px-6 border-b border-slate-200 dark:border-white/10 bg-white/90 dark:bg-[#0e1117]/90 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarMobileOpen(true)}
              aria-label="Open navigation menu"
              className="md:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>

            {sidebarDesktopCollapsed && (
              <button
                type="button"
                onClick={() => setSidebarDesktopCollapsed(false)}
                aria-label="Expand sidebar"
                className="hidden md:inline-flex p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
              >
                <PanelLeftOpen className="w-5 h-5" />
              </button>
            )}

            <div className={`flex items-center gap-2.5 min-w-0 ${!sidebarDesktopCollapsed ? 'md:hidden' : ''}`}>
              <img
                src="/logo.png"
                alt="SARTHI AI"
                className="w-7 h-7 rounded-lg object-cover border border-slate-200 dark:border-white/15 shrink-0"
                referrerPolicy="no-referrer"
              />
              <span className="font-display font-bold text-base tracking-tight whitespace-nowrap shrink-0">
                SARTHI AI
              </span>
            </div>

            {activeChat && (
              <span className="hidden md:block text-sm font-medium text-slate-600 dark:text-slate-300 truncate max-w-md">
                {activeChat.title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleNewChat}
              className="md:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Chat</span>
            </button>

            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label="Toggle color theme"
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </header>

        {/* Scrollable Chat Viewport */}
        <main className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="min-h-full flex flex-col items-center justify-center px-4 py-10">
              <div className="w-full max-w-2xl text-center">
                <img
                  src="/logo.png"
                  alt="SARTHI AI"
                  className="w-20 h-20 mx-auto rounded-2xl object-cover border border-slate-200 dark:border-white/15 mb-5 shadow-xs"
                  referrerPolicy="no-referrer"
                />
                <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
                  Namaste, {firstName}
                </h1>
                <p className="mt-2.5 text-[15px] text-slate-600 dark:text-slate-400 max-w-lg mx-auto">
                  Ask anything in English or Hindi, search the live web, analyze uploaded images &amp; documents, or generate AI images and videos.
                </p>

                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                  {SUGGESTION_CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => {
                        setMode(chip.mode);
                        void submitPrompt(chip.prompt, chip.mode);
                      }}
                      className="group flex items-start gap-3 p-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-[#161b22] hover:border-blue-400/60 dark:hover:border-blue-500/40 hover:bg-slate-100/70 dark:hover:bg-[#1c2330] transition-colors text-left cursor-pointer"
                    >
                      <div className="p-2 rounded-xl bg-white dark:bg-[#0e1117] border border-slate-200 dark:border-white/10 text-blue-600 dark:text-blue-400 shrink-0">
                        {chip.icon === 'globe' && <Globe className="w-4 h-4" />}
                        {chip.icon === 'hindi' && <Languages className="w-4 h-4" />}
                        {chip.icon === 'image' && <ImageIcon className="w-4 h-4" />}
                        {chip.icon === 'video' && <Video className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {chip.label}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {chip.sublabel}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  activeSpeechMessageId={activeSpeechMessageId}
                  speechStatus={speechStatus}
                  selectedVoiceURI={selectedVoiceURI}
                  onStartSpeech={startSpeech}
                  onPauseResumeSpeech={handlePauseResumeSpeech}
                  onStopSpeech={stopSpeech}
                  onSelectVoice={handleSelectVoice}
                />
              ))}

              {generating && (
                <div className="flex items-start gap-3 sm:gap-4">
                  <img
                    src="/logo.png"
                    alt="SARTHI AI"
                    className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-white/15 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                  <div className="flex items-center gap-2.5 py-2 text-sm text-slate-600 dark:text-slate-300">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
                    <span>{loadingStage || 'Thinking...'}</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </main>

        {/* Inline Error Notification */}
        {errorBanner && (
          <div className="max-w-3xl w-full mx-auto px-4 pb-1">
            <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                aria-label="Dismiss error"
                className="p-0.5 rounded hover:bg-red-200/50 dark:hover:bg-red-900/40 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Bottom Prompt Input Bar */}
        <div className="shrink-0 bg-white dark:bg-[#0e1117]">
          <PromptComposer
            prompt={prompt}
            mode={mode}
            webSearchEnabled={webSearchEnabled}
            attachment={attachment}
            uploadingFile={uploadingFile}
            generating={generating}
            onPromptChange={setPrompt}
            onModeChange={setMode}
            onToggleWebSearch={() => setWebSearchEnabled((prev) => !prev)}
            onFileSelected={handleFileSelected}
            onRemoveAttachment={() => setAttachment(null)}
            onSubmit={() => void submitPrompt()}
          />
        </div>
      </div>
    </div>
  );
}
