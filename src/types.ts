export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  data: string; // base64 data url
  size: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: ImageAttachment[];
  timestamp: number;
  modelUsed?: string;
}

export interface ModelOption {
  id: string;
  name: string;
  tag: string;
  description: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    tag: 'DEFAULT / SMART',
    description: 'Balanced speed, advanced reasoning, and multimodal analysis.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    tag: 'CHEAPEST / HIGHEST LIMITS',
    description: 'Lowest cost per token with highest rate limits & fastest response times.',
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    tag: 'BALANCED',
    description: 'Fast, dependable performance for diverse conversational tasks.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    tag: 'LIGHTWEIGHT',
    description: 'Cost-efficient and fast with high throughput.',
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash Latest',
    tag: 'LATEST RELEASE',
    description: 'Always routes to the latest Flash model release.',
  },
];


