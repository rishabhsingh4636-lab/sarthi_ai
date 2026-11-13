import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { ChatMessage, ChatMode, ChatSession, MediaType, UserProfile, WebSource } from '../types/chat';

function toMillis(val: unknown): number {
  if (val instanceof Timestamp) {
    return val.toMillis();
  }
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export async function upsertUserProfile(
  user: User,
  preferredTheme: 'light' | 'dark' = 'dark',
): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);

  const safeDisplayName = (user.displayName || user.email?.split('@')[0] || 'SARTHI User').slice(0, 120);
  const safeEmail = (user.email || `${user.uid}@user.local`).slice(0, 256);
  const safePhoto = user.photoURL ? user.photoURL.slice(0, 1000) : undefined;

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const payload: Record<string, unknown> = {
        uid: user.uid,
        email: safeEmail,
        displayName: safeDisplayName,
        preferredTheme,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (safePhoto) {
        payload.photoURL = safePhoto;
      }
      await setDoc(ref, payload);
      return {
        uid: user.uid,
        email: safeEmail,
        displayName: safeDisplayName,
        photoURL: safePhoto,
        preferredTheme,
      };
    }

    const existing = snap.data();
    const resolvedTheme =
      existing.preferredTheme === 'light' || existing.preferredTheme === 'dark'
        ? existing.preferredTheme
        : preferredTheme;

    const updatePayload: Record<string, unknown> = {
      email: safeEmail,
      displayName: safeDisplayName,
      preferredTheme: resolvedTheme,
      updatedAt: serverTimestamp(),
    };
    if (safePhoto) {
      updatePayload.photoURL = safePhoto;
    }

    await updateDoc(ref, updatePayload);
    return {
      uid: user.uid,
      email: safeEmail,
      displayName: safeDisplayName,
      photoURL: safePhoto || existing.photoURL,
      preferredTheme: resolvedTheme,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserTheme(uid: string, preferredTheme: 'light' | 'dark'): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      preferredTheme,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToUserChats(
  uid: string,
  onChats: (chats: ChatSession[]) => void,
): () => void {
  const path = 'chats';
  const q = query(collection(db, path), where('userId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: ChatSession[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          userId: String(data.userId || uid),
          title: String(data.title || 'New Chat'),
          mode: (data.mode === 'image' || data.mode === 'video' ? data.mode : 'chat') as ChatMode,
          createdAtMs: toMillis(data.createdAt),
          updatedAtMs: toMillis(data.updatedAt),
        };
      });
      list.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onChats(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export function subscribeToChatMessages(
  chatId: string,
  uid: string,
  onMessages: (messages: ChatMessage[]) => void,
): () => void {
  const path = `chats/${chatId}/messages`;
  const q = query(collection(db, 'chats', chatId, 'messages'), where('userId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: ChatMessage[] = snapshot.docs.map((d) => {
        const data = d.data();
        const rawSources = Array.isArray(data.sources) ? data.sources : undefined;
        const sources: WebSource[] | undefined = rawSources
          ?.filter(
            (s): s is WebSource =>
              Boolean(s) && typeof s.title === 'string' && typeof s.url === 'string',
          )
          .slice(0, 8);

        return {
          id: d.id,
          chatId: String(data.chatId || chatId),
          userId: String(data.userId || uid),
          role: data.role === 'user' ? 'user' : 'assistant',
          mode: (data.mode === 'image' || data.mode === 'video' ? data.mode : 'chat') as ChatMode,
          content: String(data.content || ''),
          mediaType: (['none', 'image', 'video', 'document'].includes(data.mediaType)
            ? data.mediaType
            : 'none') as MediaType,
          mediaUrl: typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined,
          attachmentName:
            typeof data.attachmentName === 'string' ? data.attachmentName : undefined,
          sources,
          language:
            data.language === 'hi' || data.language === 'en' || data.language === 'auto'
              ? data.language
              : 'auto',
          createdAtMs: toMillis(data.createdAt),
        };
      });
      list.sort((a, b) => a.createdAtMs - b.createdAtMs);
      onMessages(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export async function createChatSession(
  chatId: string,
  uid: string,
  title: string,
  mode: ChatMode,
): Promise<void> {
  const path = `chats/${chatId}`;
  const safeTitle = (title.trim() || 'New Chat').slice(0, 160);
  try {
    await setDoc(doc(db, 'chats', chatId), {
      userId: uid,
      title: safeTitle,
      mode,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function touchChatSession(chatId: string, mode: ChatMode, title?: string): Promise<void> {
  const path = `chats/${chatId}`;
  const payload: Record<string, unknown> = {
    mode,
    updatedAt: serverTimestamp(),
  };
  if (title && title.trim()) {
    payload.title = title.trim().slice(0, 160);
  }
  try {
    await updateDoc(doc(db, 'chats', chatId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveMessageToChat(params: {
  chatId: string;
  messageId: string;
  userId: string;
  role: 'user' | 'assistant';
  mode: ChatMode;
  content: string;
  mediaType: MediaType;
  mediaUrl?: string;
  attachmentName?: string;
  sources?: WebSource[];
  language?: 'hi' | 'en' | 'auto';
}): Promise<void> {
  const path = `chats/${params.chatId}/messages/${params.messageId}`;
  const payload: Record<string, unknown> = {
    chatId: params.chatId,
    userId: params.userId,
    role: params.role,
    mode: params.mode,
    content: params.content.slice(0, 32000),
    mediaType: params.mediaType,
    createdAt: serverTimestamp(),
  };

  if (params.mediaUrl && params.mediaUrl.length <= 200000) {
    payload.mediaUrl = params.mediaUrl;
  }
  if (params.attachmentName) {
    payload.attachmentName = params.attachmentName.slice(0, 256);
  }
  if (params.sources && params.sources.length > 0) {
    payload.sources = params.sources.slice(0, 8).map((s) => ({
      title: String(s.title || 'Source').slice(0, 300),
      url: String(s.url || '').slice(0, 1000),
    }));
  }
  if (params.language) {
    payload.language = params.language;
  }

  try {
    await setDoc(doc(db, 'chats', params.chatId, 'messages', params.messageId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteChatSession(chatId: string, uid: string): Promise<void> {
  const path = `chats/${chatId}`;
  try {
    const messagesQuery = query(
      collection(db, 'chats', chatId, 'messages'),
      where('userId', '==', uid),
    );
    const snap = await getDocs(messagesQuery);
    await Promise.all(
      snap.docs.map((m) => deleteDoc(doc(db, 'chats', chatId, 'messages', m.id))),
    );
    await deleteDoc(doc(db, 'chats', chatId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
