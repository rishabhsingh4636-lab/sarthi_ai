# SARTHI AI

A full-stack, bilingual (Hindi & English) AI workspace inspired by Google Gemini's clean light/dark interface. Built with React, Tailwind CSS, Express, Firebase Auth & Firestore, Groq LPU inference, and Hugging Face media generation.

## Features

- **Authentication & Per-User History**: Google Sign-In and Email/Password authentication powered by Firebase Auth, with persistent per-user chat history in Cloud Firestore.
- **Bilingual Chat & Live Web Search (`/api/chat`)**: Uses Groq LPU inference with automatic keyless DuckDuckGo/Wikipedia live web search grounding and cited source links. Automatically replies in warm Devanagari Hindi when prompted in Hindi/Hinglish and in English when prompted in English.
- **Auto-Detect Text-to-Speech (TTS)**: Speaker button on every assistant response automatically detects Devanagari Hindi (`hi-IN`) vs English (`en-US`) and reads aloud using Web Speech API with Play/Pause/Stop controls and manual voice selection.
- **Multimodal Vision & Document Upload (`/api/upload`)**: Upload images (JPG, PNG, WebP) for `@google/genai` (`gemini-4-hydrogen`) & active Groq Llama 4 vision analysis, or documents (PDF, TXT, DOCX) for server-side text extraction and Q&A.
- **Image Generation Mode (`/api/image`)**: Translates Hindi/Hinglish prompts into rich English visual prompts, generates free unlimited artwork via Pollinations.ai (`nologo=true`), crops cleanly to 1:1 with the **SARTHI AI** badge, and downloads directly as a local JPEG.
- **Video Generation Mode (`/api/video`)**: Connects to Hugging Face Text-to-Video Inference Providers when credits are available, and gracefully displays a helpful fallback message inside the chat if free video credits are exhausted.

## Environment Variables Setup

1. Copy `.env.example` to `.env` (or `.env.local` / Vercel Environment Variables):
   ```bash
   cp .env.example .env
   ```
2. Add your server-side API keys (never expose these in frontend `VITE_*` variables):
   - **`GROQ_API_KEY`**: Create a free key at [console.groq.com/keys](https://console.groq.com/keys).
   - **`GEMINI_API_KEY`**: Google AI Studio Gemini API key for multimodal image/vision analysis (`gemini-4-hydrogen`).
   - **`HF_TOKEN`**: Optional free token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (enable "Make calls to Inference Providers") for video generation.

## Firebase Authentication Setup

Google Sign-In is pre-configured.
- To enable Email/Password registration: in **Firebase Console -> Authentication -> Sign-in method**, enable **Email/Password**.
- When deploying to Vercel, add your `*.vercel.app` (and custom) domain under **Firebase Console -> Authentication -> Settings -> Authorized domains** so Google Sign-In works in production.

## Local Development

```bash
npm install
npm run dev
```

## Deploying to Vercel

This project includes `vercel.json` and `api/index.ts` so both the Vite React frontend and Express `/api/*` backend deploy together seamlessly on Vercel:

1. Push the project to GitHub (or run `npx vercel` from the project root).
2. Import the repository in [vercel.com/new](https://vercel.com/new).
3. Under **Environment Variables**, add:
   - `GROQ_API_KEY`
   - `GEMINI_API_KEY`
   - `HF_TOKEN` (optional, for video mode)
4. Click **Deploy** (Vercel automatically uses `npm run build` -> `dist/` and routes `/api/*` through `api/index.ts`).
5. Add your deployed Vercel domain to **Firebase Console -> Authentication -> Settings -> Authorized domains**.

