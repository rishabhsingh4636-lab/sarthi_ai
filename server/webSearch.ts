import * as cheerio from 'cheerio';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const REALTIME_KEYWORDS = [
  'news',
  'latest',
  'today',
  'current',
  'weather',
  'forecast',
  'temperature',
  'score',
  'live',
  'match',
  'cricket',
  'ipl',
  'football',
  'stock',
  'price',
  'bitcoin',
  'gold',
  'election',
  'result',
  'president',
  'prime minister',
  'pm ',
  'ceo',
  '2025',
  '2026',
  'who won',
  'when is',
  'aaj',
  'taza',
  'taaza',
  'khabar',
  'samachar',
  'mausam',
  'bhav',
  'rate',
  'update',
  'trending',
  'release date',
  'आज',
  'ताजा',
  'ताज़ा',
  'खबर',
  'समाचार',
  'मौसम',
  'स्कोर',
  'लाइव',
  'कीमत',
  'भाव',
  'कौन जीता',
  'अभी',
];

const PURE_CONVERSATIONAL_PREFIXES = [
  'hi',
  'hello',
  'hey',
  'namaste',
  'namaskar',
  'kaise ho',
  'how are you',
  'thanks',
  'thank you',
  'shukriya',
  'dhanyavad',
  'good morning',
  'good evening',
  'good night',
];

export function shouldSearchWeb(query: string, hasAttachment: boolean): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized || normalized.length < 4) return false;
  if (PURE_CONVERSATIONAL_PREFIXES.includes(normalized)) return false;

  if (REALTIME_KEYWORDS.some((kw) => normalized.includes(kw))) {
    return true;
  }

  // In Chat Mode without an attachment, search factual/question queries automatically
  if (!hasAttachment && (normalized.includes('?') || normalized.split(/\s+/).length >= 4)) {
    const pureCodingOrCreative = [
      'write a poem',
      'write a story',
      'write code',
      'fix this code',
      'translate',
      'kavita likho',
      'kahani likho',
      'essay on',
      'nibandh',
    ];
    if (pureCodingOrCreative.some((p) => normalized.includes(p))) {
      return false;
    }
    return true;
  }

  return false;
}

function decodeDuckDuckGoUrl(rawHref: string): string {
  try {
    if (rawHref.startsWith('//')) {
      rawHref = `https:${rawHref}`;
    }
    const parsed = new URL(rawHref, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
      return rawHref;
    }
    return '';
  } catch {
    return '';
  }
}

async function searchDuckDuckGoHtml(query: string): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const params = new URLSearchParams({ q: query, kl: 'wt-wt' });
    const res = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
      },
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('.result').each((_, el) => {
      if (results.length >= 5) return false;
      const anchor = $(el).find('a.result__a').first();
      const title = anchor.text().trim();
      const rawHref = anchor.attr('href') || '';
      const url = decodeDuckDuckGoUrl(rawHref);
      const snippet = $(el).find('.result__snippet').first().text().trim();

      if (title && url && url.startsWith('http')) {
        results.push({
          title: title.slice(0, 200),
          url: url.slice(0, 500),
          snippet: snippet.slice(0, 400),
        });
      }
      return undefined;
    });

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function searchDuckDuckGoInstant(query: string): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
    });
    const res = await fetch(`https://api.duckduckgo.com/?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const results: SearchResult[] = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.AbstractText.slice(0, 400),
      });
    }

    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= 4) break;
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0]?.slice(0, 120) || query,
            url: topic.FirstURL,
            snippet: topic.Text.slice(0, 350),
          });
        }
      }
    }

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWikipediaFallback(query: string): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: '4',
      format: 'json',
    });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
      headers: { 'User-Agent': 'SarthiAI/1.0 (https://sarthi.ai)' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        search?: Array<{ title: string; snippet: string }>;
      };
    };

    const items = data.query?.search || [];
    return items.map((item) => {
      const cleanSnippet = cheerio.load(item.snippet).text().trim();
      return {
        title: `${item.title} — Wikipedia`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
        snippet: cleanSnippet.slice(0, 350),
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function performLiveWebSearch(query: string): Promise<SearchResult[]> {
  const cleaned = query.trim();
  if (!cleaned) return [];

  const htmlResults = await searchDuckDuckGoHtml(cleaned);
  if (htmlResults.length > 0) {
    return htmlResults;
  }

  const instantResults = await searchDuckDuckGoInstant(cleaned);
  if (instantResults.length > 0) {
    return instantResults;
  }

  return await searchWikipediaFallback(cleaned);
}
