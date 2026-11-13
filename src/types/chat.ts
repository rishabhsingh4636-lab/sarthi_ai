export type ChatMode = 'chat' | 'image' | 'video';

export type MediaType = 'none' | 'image' | 'video' | 'document';

export interface WebSource {
  title: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  userId: string;
  role: 'user' | 'assistant';
  mode: ChatMode;
  content: string;
  mediaType: MediaType;
  mediaUrl?: string;
  attachmentName?: string;
  sources?: WebSource[];
  language?: 'hi' | 'en' | 'auto';
  createdAtMs: number;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  mode: ChatMode;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface UploadedAttachment {
  kind: 'image' | 'document';
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  previewDataUrl?: string;
  extractedText?: string;
  charCount?: number;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  preferredTheme: 'light' | 'dark';
}
