import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { InferenceClient } from '@huggingface/inference';
import express from 'express';
import mammoth from 'mammoth';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { performLiveWebSearch, shouldSearchWeb, type SearchResult } from './webSearch.ts';

const MEDIA_DIR = path.join('/tmp', 'sarthi-media');
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|mp4|webm)$/;

async function ensureMediaDir(): Promise<void> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB
  },
});

interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  message?: string;
  history?: ChatHistoryItem[];
  imageDataUrl?: string;
  documentText?: string;
  documentName?: string;
  enableWebSearch?: boolean;
}

interface GroqResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
    code?: string;
  };
}

function detectLanguageHint(text: string): 'hi' | 'en' {
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hi';
  }
  const hinglishHints = [
    'kaise',
    'kya',
    'kyu',
    'kyon',
    'hai',
    'hain',
    'batao',
    'samjhao',
    'mujhe',
    'tum',
    'aap',
    'namaste',
    'shukriya',
    'mausam',
    'khabar',
    'likho',
    'karo',
    'hindi',
    'mein',
    'mera',
    'meri',
  ];
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  const matches = words.filter((w) => hinglishHints.includes(w.replace(/[^\w]/g, '')));
  return matches.length >= 2 ? 'hi' : 'en';
}

let cachedChatModel: string | null = null;
let cachedVisionModel: string | null = null;

async function callGroqChat(
  apiKey: string,
  model: string,
  messages: Array<Record<string, unknown>>,
): Promise<{ ok: true; content: string; model: string } | { ok: false; status: number; message: string }> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.65,
      max_tokens: 2048,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as GroqResponse;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: data.error?.message || `Groq API error (${res.status})`,
    };
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return {
      ok: false,
      status: 502,
      message: 'Groq returned an empty response.',
    };
  }

  return { ok: true, content, model };
}

async function callGeminiVision(
  geminiApiKey: string,
  systemPrompt: string,
  history: ChatHistoryItem[],
  promptText: string,
  imageDataUrl: string,
): Promise<{ ok: true; content: string; model: string } | { ok: false; status: number; message: string }> {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(imageDataUrl);
  if (!match) {
    return { ok: false, status: 400, message: 'Invalid image data format for vision analysis.' };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const contents = [
      ...history.map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content.slice(0, 4000) }],
      })),
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: match[1],
              data: match[2],
            },
          },
          { text: promptText },
        ],
      },
    ];

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    const content = response.text?.trim();
    if (!content) {
      return {
        ok: false,
        status: 502,
        message: 'Vision model returned an empty response. Please try again.',
      };
    }

    return { ok: true, content, model: 'gemini-4-hydrogen' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /401|403|permission_denied|api_key_invalid/i.test(message)
      ? 403
      : /429|resource_exhausted/i.test(message)
        ? 429
        : 502;
    return {
      ok: false,
      status,
      message: message || 'Gemini vision analysis failed.',
    };
  }
}

async function runGroqTextCompletion(
  groqApiKey: string,
  messages: Array<Record<string, unknown>>,
): Promise<{ ok: true; content: string; model: string } | { ok: false; status: number; message: string }> {
  const chatCandidates = [
    ...(cachedChatModel ? [cachedChatModel] : []),
    'llama-3.1-8b-instant',
    'llama-3.1-70b-versatile',
    'llama-3.3-70b-versatile',
    'gemma2-9b-it',
    'mixtral-8x7b-32768',
  ];
  const chatModels = Array.from(new Set(chatCandidates));

  let lastChatErr: { status: number; message: string } = {
    status: 502,
    message: 'Groq chat inference failed.',
  };

  for (const model of chatModels) {
    const result = await callGroqChat(groqApiKey, model, messages);
    if (result.ok) {
      cachedChatModel = result.model;
      return result;
    }
    if (cachedChatModel === model) cachedChatModel = null;
    lastChatErr = { status: result.status, message: result.message };
    if (result.status === 401 || result.status === 403) {
      return { ok: false, status: result.status, message: result.message };
    }
  }

  try {
    const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${groqApiKey}` },
    });
    if (modelsRes.ok) {
      const modelsJson = (await modelsRes.json()) as {
        data?: Array<{ id?: string; active?: boolean }>;
      };
      const preferredOrder = [
        'llama-3.3-70b',
        'llama-3.1-70b',
        'llama-3.1-8b',
        'llama-4',
        'gpt-oss-120b',
        'gpt-oss-20b',
        'qwen',
        'gemma',
        'mixtral',
      ];
      const rankModel = (id: string): number => {
        const lower = id.toLowerCase();
        if (lower.includes('allam')) return 999;
        const idx = preferredOrder.findIndex((prefix) => lower.includes(prefix));
        return idx === -1 ? 500 : idx;
      };

      const dynamicCandidates = (modelsJson.data || [])
        .filter((m) => m.active !== false && typeof m.id === 'string')
        .map((m) => m.id as string)
        .filter(
          (id) =>
            !chatModels.includes(id) &&
            !/whisper|guard|safeguard|tts|orpheus|embed|rerank/i.test(id),
        )
        .sort((a, b) => rankModel(a) - rankModel(b));

      for (const fallbackModel of dynamicCandidates.slice(0, 4)) {
        const result = await callGroqChat(groqApiKey, fallbackModel, messages);
        if (result.ok) {
          cachedChatModel = result.model;
          return result;
        }
        lastChatErr = { status: result.status, message: result.message };
      }
    }
  } catch {
    // Ignore model-listing error
  }

  return { ok: false, status: lastChatErr.status, message: lastChatErr.message };
}

const HINGLISH_IMAGE_WORDS = new Set([
  'ek', 'do', 'teen', 'ka', 'ki', 'ke', 'ko', 'se', 'par', 'pe', 'mein', 'me', 'aur',
  'banao', 'banaye', 'bnao', 'dikhao', 'tasveer', 'chitra', 'sundar', 'khubsurat',
  'raat', 'subah', 'shaam', 'dhoop', 'barish', 'pahad', 'nadi', 'samundar', 'mandir',
  'gaon', 'shahar', 'ladka', 'ladki', 'aadmi', 'aurat', 'bacha', 'sher', 'hathi',
  'mor', 'phool', 'ped', 'aakash', 'chand', 'suraj', 'sitare', 'diya', 'deepak',
  'rang', 'kala', 'neela', 'laal', 'hara', 'peela', 'safed', 'jaisa', 'wala', 'wali',
  'baitha', 'baithi', 'udta', 'chalta', 'daudta', 'muskurata', 'khada', 'bhagwan',
  'bharat', 'bharatiya', 'chai', 'ghar', 'sadak', 'bazaar', 'duniya', 'mera', 'meri',
  'apna', 'apni', 'kuch', 'pyara', 'pyari', 'pani', 'hawa', 'aag', 'khet', 'gaon',
  'rani', 'raja', 'ghoda', 'kutta', 'billi', 'chidiya', 'parvat', 'ganga', 'banaras',
]);

function isHindiOrHinglishPrompt(text: string): boolean {
  if (/[\u0900-\u097F]/.test(text)) {
    return true;
  }
  const words = text.toLowerCase().split(/\s+/);
  let hits = 0;
  for (const word of words) {
    const clean = word.replace(/[^\w]/g, '');
    if (clean && HINGLISH_IMAGE_WORDS.has(clean)) {
      hits += 1;
    }
  }
  return hits >= 1;
}

async function translateImagePromptIfNeeded(
  rawPrompt: string,
): Promise<{ finalPrompt: string; translated: boolean }> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey || !isHindiOrHinglishPrompt(rawPrompt)) {
    return { finalPrompt: rawPrompt, translated: false };
  }

  const messages: Array<Record<string, unknown>> = [
    {
      role: 'system',
      content:
        'You are an expert AI image-generation prompt translator. Translate the user\'s Hindi or Hinglish prompt into a rich, vivid, visually descriptive English prompt for an AI image generator. Preserve every subject, Indian/cultural detail, attire, mood, and setting. Output ONLY the final English prompt (20-65 words), with no quotes, no markdown, and no explanation.',
    },
    {
      role: 'user',
      content: rawPrompt,
    },
  ];

  const result = await runGroqTextCompletion(groqApiKey, messages);
  if (!result.ok) {
    return { finalPrompt: rawPrompt, translated: false };
  }

  const cleaned = result.content
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return { finalPrompt: rawPrompt, translated: false };
  }

  return { finalPrompt: cleaned, translated: true };
}

async function generatePollinationsImage(
  prompt: string,
): Promise<{ ok: true; buffer: Buffer; contentType: string; model: string } | { ok: false; status: number; message: string }> {
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1120&nologo=true&private=true&seed=${seed}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,*/*',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        ok: false,
        status: res.status >= 500 ? 502 : res.status,
        message: `Image generation service returned HTTP ${res.status}. Please try again.`,
      };
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return {
        ok: false,
        status: 502,
        message: 'Image service returned an unexpected response format. Please try again.',
      };
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.byteLength < 512) {
      return {
        ok: false,
        status: 502,
        message: 'Generated image was empty. Please try a slightly different prompt.',
      };
    }

    return {
      ok: true,
      buffer,
      contentType,
      model: 'pollinations-flux',
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Image generation timed out. Please try again.'
        : err instanceof Error
          ? err.message
          : 'Failed to connect to Pollinations.ai image service.';
    return { ok: false, status: 504, message };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateHuggingFaceVideo(
  token: string,
  prompt: string,
): Promise<{ ok: true; buffer: Buffer; contentType: string; model: string } | { ok: false; status: number; message: string }> {
  const client = new InferenceClient(token);
  const attempts: Array<{ model: string; provider: 'auto' | 'fal-ai' | 'wavespeed' }> = [
    { model: 'Wan-AI/Wan2.2-TI2V-5B', provider: 'auto' },
    { model: 'Wan-AI/Wan2.1-T2V-14B', provider: 'auto' },
    { model: 'Wan-AI/Wan2.1-T2V-1.3B', provider: 'auto' },
    { model: 'tencent/HunyuanVideo', provider: 'auto' },
  ];

  const errors: string[] = [];
  let lastStatus = 502;

  for (const attempt of attempts) {
    try {
      const blob = await client.textToVideo({
        model: attempt.model,
        inputs: prompt,
        provider: attempt.provider,
      });

      const arrayBuf = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.byteLength > 256) {
        return {
          ok: true,
          buffer,
          contentType: blob.type || 'video/mp4',
          model: attempt.model,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${attempt.model} (${attempt.provider}): ${message}`);
      if (/401|unauthorized|invalid username|token/i.test(message)) {
        return {
          ok: false,
          status: 401,
          message:
            'Invalid or unauthorized HF_TOKEN. Please verify your Hugging Face token has "Make calls to Inference Providers" enabled.',
        };
      }
      if (/402|payment|credit|quota/i.test(message)) {
        lastStatus = 402;
      } else {
        lastStatus = 502;
      }
    }
  }

  return { ok: false, status: lastStatus, message: errors[0] || 'Hugging Face video generation failed.' };
}

export const apiRouter = express.Router();

apiRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    hfConfigured: Boolean(process.env.HF_TOKEN),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
});

apiRouter.get('/media/:filename', async (req, res) => {
  const filename = req.params.filename;
  if (!SAFE_FILENAME_RE.test(filename)) {
    res.status(400).json({ error: 'Invalid media filename.' });
    return;
  }

  const fullPath = path.join(MEDIA_DIR, filename);
  try {
    await fs.access(fullPath);
    if (filename.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (filename.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (filename.endsWith('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    } else {
      res.setHeader('Content-Type', 'image/png');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }
    res.sendFile(fullPath);
  } catch {
    res.status(404).json({ error: 'Generated media not found or expired.' });
  }
});

apiRouter.post('/upload', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file provided.' });
    return;
  }

  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype.toLowerCase();

  const isImage =
    mime.startsWith('image/') && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext || '.png');

  if (isImage) {
    const base64 = file.buffer.toString('base64');
    const dataUrl = `data:${file.mimetype};base64,${base64}`;
    res.json({
      kind: 'image',
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      dataUrl,
    });
    return;
  }

  try {
    let extractedText = '';

    if (ext === '.pdf' || mime === 'application/pdf') {
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      try {
        const result = await parser.getText();
        extractedText = result.text || '';
      } finally {
        await parser.destroy();
      }
    } else if (
      ext === '.docx' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      extractedText = result.value || '';
    } else if (ext === '.txt' || ext === '.md' || ext === '.csv' || mime.startsWith('text/')) {
      extractedText = file.buffer.toString('utf-8');
    } else {
      res.status(400).json({
        error: 'Unsupported file format. Please upload JPG, PNG, WebP, PDF, TXT, or DOCX.',
      });
      return;
    }

    const normalized = extractedText.replace(/\s+\n/g, '\n').trim();
    const truncated = normalized.slice(0, 24000);

    if (!truncated) {
      res.status(422).json({
        error: 'No readable text could be extracted from this document.',
      });
      return;
    }

    res.json({
      kind: 'document',
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      extractedText: truncated,
      charCount: normalized.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process uploaded file.';
    res.status(500).json({ error: message });
  }
});

apiRouter.post('/chat', async (req, res) => {
  const groqApiKey = process.env.GROQ_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const body = (req.body || {}) as ChatRequestBody;
  const hasImagePayload =
    typeof body.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:image/');

  if (!groqApiKey && !(hasImagePayload && geminiApiKey)) {
    res.status(503).json({
      error:
        'GROQ_API_KEY is not configured in server environment variables. Add GROQ_API_KEY to your Secrets or .env file.',
      code: 'MISSING_GROQ_KEY',
    });
    return;
  }
  const userMessage = typeof body.message === 'string' ? body.message.trim() : '';
  const imageDataUrl =
    typeof body.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:image/')
      ? body.imageDataUrl
      : '';
  const documentText = typeof body.documentText === 'string' ? body.documentText.trim() : '';
  const documentName = typeof body.documentName === 'string' ? body.documentName.trim() : 'Document';
  const enableWebSearch = body.enableWebSearch !== false;

  if (!userMessage && !imageDataUrl && !documentText) {
    res.status(400).json({ error: 'Please enter a message or attach a file.' });
    return;
  }

  const hasAttachment = Boolean(imageDataUrl || documentText);
  let sources: SearchResult[] = [];

  if (enableWebSearch && userMessage && shouldSearchWeb(userMessage, hasAttachment)) {
    sources = await performLiveWebSearch(userMessage);
  }

  const todayIso = new Date().toISOString().split('T')[0];
  const systemParts = [
    `You are SARTHI AI (सारथी), a warm, friendly, empathetic, and smart human-like companion and guide.`,
    `Current date: ${todayIso}.`,
    `Conversational Persona & Tone:`,
    `- Talk naturally like an approachable, helpful human friend — never sound robotic, textbook-like, or overly formal.`,
    `- Do NOT add unnecessary section headers (like "## आज का दिन कैसा है?" or "**सारांश:**") or rigid bullet lists for casual greetings, everyday chat, or simple questions. Reply in smooth, natural paragraphs unless the user asks for steps, comparisons, lists, or code.`,
    `- Never say stiff phrases like "As an AI language model..." or "मैं एक कृत्रिम बुद्धिमत्ता सहायक हूँ".`,
    `Language Policy (STRICT):`,
    `- Whenever the user writes in Hindi (Devanagari) OR Hinglish (Romanized Hindi such as "kaise ho", "aaj ka mausam batao", "mujhe samjhao", "kya haal hai"), ALWAYS respond in warm, natural, everyday spoken Devanagari Hindi (हिन्दी) — using respectful, friendly phrasing ("आप", "बिल्कुल", "अरे वाह", "देखिए", "चलिए समझते हैं").`,
    `- Whenever the user writes in English, ALWAYS respond in clear, friendly, natural English.`,
  ];

  if (sources.length > 0) {
    const contextLines = sources
      .map(
        (s, idx) =>
          `[${idx + 1}] ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet || 'No snippet'}`,
      )
      .join('\n\n');
    systemParts.push(
      `Live Internet Search Results (use these up-to-date facts and cite source titles/URLs accurately without inventing links):\n\n${contextLines}`,
    );
  }

  if (documentText) {
    systemParts.push(
      `Uploaded Document Content (${documentName}):\n"""\n${documentText.slice(0, 20000)}\n"""`,
    );
  }

  const systemPrompt = systemParts.join('\n\n');

  const safeHistory = Array.isArray(body.history)
    ? body.history
        .filter(
          (item): item is ChatHistoryItem =>
            Boolean(item) &&
            (item.role === 'user' || item.role === 'assistant') &&
            typeof item.content === 'string' &&
            item.content.trim().length > 0,
        )
        .slice(-10)
    : [];

  const promptText =
    userMessage ||
    (imageDataUrl
      ? 'Please analyze this image carefully and describe what you see.'
      : 'Please summarize and explain the key points of this uploaded document.');

  if (imageDataUrl) {
    let lastErr: { status: number; message: string } = {
      status: 502,
      message: 'Image analysis failed. Please try again.',
    };

    if (geminiApiKey) {
      const geminiResult = await callGeminiVision(
        geminiApiKey,
        systemPrompt,
        safeHistory,
        promptText,
        imageDataUrl,
      );
      if (geminiResult.ok) {
        res.json({
          reply: geminiResult.content,
          model: geminiResult.model,
          language: detectLanguageHint(geminiResult.content),
          sources,
          searchUsed: sources.length > 0,
        });
        return;
      }
      lastErr = { status: geminiResult.status, message: geminiResult.message };
    }

    if (groqApiKey) {
      const visionMessages: Array<Record<string, unknown>> = [
        { role: 'system', content: systemPrompt },
        ...safeHistory.map((h) => ({ role: h.role, content: h.content.slice(0, 4000) })),
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ];

      const visionCandidates = [
        ...(cachedVisionModel ? [cachedVisionModel] : []),
        'meta-llama/llama-4-scout-17b-16e-instruct',
        'meta-llama/llama-4-maverick-17b-128e-instruct',
      ];
      const visionModels = Array.from(new Set(visionCandidates));

      for (const model of visionModels) {
        const result = await callGroqChat(groqApiKey, model, visionMessages);
        if (result.ok) {
          cachedVisionModel = result.model;
          res.json({
            reply: result.content,
            model: result.model,
            language: detectLanguageHint(result.content),
            sources,
            searchUsed: sources.length > 0,
          });
          return;
        }
        if (cachedVisionModel === model) cachedVisionModel = null;
        lastErr = { status: result.status, message: result.message };
        if (result.status === 401 || result.status === 403) break;
      }
    }

    res.status(lastErr.status).json({ error: lastErr.message });
    return;
  }

  if (!groqApiKey) {
    res.status(503).json({
      error:
        'GROQ_API_KEY is not configured in server environment variables. Add GROQ_API_KEY to your Secrets or .env file.',
      code: 'MISSING_GROQ_KEY',
    });
    return;
  }

  const chatMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
    ...safeHistory.map((h) => ({ role: h.role, content: h.content.slice(0, 4000) })),
    { role: 'user', content: promptText },
  ];

  const result = await runGroqTextCompletion(groqApiKey, chatMessages);
  if (!result.ok) {
    res.status(result.status).json({ error: result.message });
    return;
  }

  res.json({
    reply: result.content,
    model: result.model,
    language: detectLanguageHint(result.content),
    sources,
    searchUsed: sources.length > 0,
  });
});

apiRouter.post('/image', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ error: 'Please provide an image prompt.' });
    return;
  }

  const { finalPrompt, translated } = await translateImagePromptIfNeeded(prompt);
  const result = await generatePollinationsImage(finalPrompt);

  if (!result.ok) {
    res.status(result.status).json({ error: result.message });
    return;
  }

  const mimeType = result.contentType || 'image/jpeg';
  if (process.env.VERCEL === '1') {
    res.json({
      imageUrl: `data:${mimeType};base64,${result.buffer.toString('base64')}`,
      mimeType,
      model: result.model,
      prompt,
      enhancedPrompt: finalPrompt,
      translated,
    });
    return;
  }

  await ensureMediaDir();
  const ext = result.contentType.includes('png')
    ? 'png'
    : result.contentType.includes('webp')
      ? 'webp'
      : 'jpg';
  const filename = `img-${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(MEDIA_DIR, filename), result.buffer);

  res.json({
    imageUrl: `/api/media/${filename}`,
    mimeType,
    model: result.model,
    prompt,
    enhancedPrompt: finalPrompt,
    translated,
  });
});

apiRouter.post('/video', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ error: 'Please provide a video prompt.' });
    return;
  }

  const lang = detectLanguageHint(prompt);
  const gracefulUnavailableMessage =
    lang === 'hi'
      ? `अभी फ्री वीडियो जनरेशन क्रेडिट्स उपलब्ध नहीं हैं, इसलिए वीडियो क्लिप नहीं बन सकी। लेकिन आप चाहें तो **Create Image** मोड चुनकर "${prompt}" की शानदार 1024×1024 तस्वीर बिल्कुल मुफ्त बना सकते हैं, या **Chat** मोड में मुझसे इस दृश्य का पूरा वीडियो स्क्रिप्ट और स्टोरीबोर्ड लिखवा सकते हैं!`
      : `Free cloud video generation credits are currently unavailable on the connected Hugging Face provider, so I couldn't render an MP4 clip right now. However, you can switch to **Create Image** to generate free unlimited 1024×1024 artwork for "${prompt}", or ask me in **Chat** mode to write a full shot-by-shot storyboard and script!`;

  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    res.json({
      unavailable: true,
      language: lang,
      message: gracefulUnavailableMessage,
      prompt,
    });
    return;
  }

  const result = await generateHuggingFaceVideo(hfToken, prompt);

  if (!result.ok) {
    res.json({
      unavailable: true,
      language: lang,
      reason: result.message,
      message: gracefulUnavailableMessage,
      prompt,
    });
    return;
  }

  const mimeType = result.contentType || 'video/mp4';
  if (process.env.VERCEL === '1') {
    res.json({
      videoUrl: `data:${mimeType};base64,${result.buffer.toString('base64')}`,
      mimeType,
      model: result.model,
      prompt,
    });
    return;
  }

  await ensureMediaDir();
  const ext = result.contentType.includes('webm') ? 'webm' : 'mp4';
  const filename = `vid-${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(MEDIA_DIR, filename), result.buffer);

  res.json({
    videoUrl: `/api/media/${filename}`,
    mimeType,
    model: result.model,
    prompt,
  });
});
