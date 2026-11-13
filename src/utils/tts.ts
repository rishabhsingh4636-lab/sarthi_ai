export function detectSpeechLang(text: string): 'hi-IN' | 'en-US' {
  const devanagariMatches = text.match(/[\u0900-\u097F]/g);
  if (devanagariMatches && devanagariMatches.length >= 2) {
    return 'hi-IN';
  }
  return 'en-US';
}

export function stripMarkdownForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' Code snippet omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function getSortedSpeechVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }
  const voices = window.speechSynthesis.getVoices();
  return [...voices].sort((a, b) => {
    const aIsPreferred = a.lang.startsWith('hi') || a.lang.startsWith('en');
    const bIsPreferred = b.lang.startsWith('hi') || b.lang.startsWith('en');
    if (aIsPreferred && !bIsPreferred) return -1;
    if (!aIsPreferred && bIsPreferred) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function pickVoiceForLang(
  voices: SpeechSynthesisVoice[],
  lang: 'hi-IN' | 'en-US',
  preferredVoiceURI?: string,
): SpeechSynthesisVoice | null {
  if (preferredVoiceURI) {
    const match = voices.find((v) => v.voiceURI === preferredVoiceURI);
    if (match) return match;
  }

  if (lang === 'hi-IN') {
    return (
      voices.find((v) => v.lang.toLowerCase() === 'hi-in' && v.name.toLowerCase().includes('google')) ||
      voices.find((v) => v.lang.toLowerCase() === 'hi-in') ||
      voices.find((v) => v.lang.toLowerCase().startsWith('hi')) ||
      null
    );
  }

  return (
    voices.find((v) => v.lang.toLowerCase() === 'en-us' && v.name.toLowerCase().includes('google')) ||
    voices.find((v) => v.lang.toLowerCase() === 'en-in') ||
    voices.find((v) => v.lang.toLowerCase() === 'en-us') ||
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
    null
  );
}
