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
  groundingSources?: { uri: string; title: string }[];
}

export interface ModelOption {
  id: string;
  name: string;
  tag: string;
  description: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    tag: 'DEFAULT / MAX QUOTA',
    description: 'Lowest cost per token with highest rate limits & fastest response times.',
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    tag: 'MOST CAPABLE',
    description: 'Advanced multimodal reasoning, deep coding, and agentic workflows.',
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    tag: 'BALANCED',
    description: 'High-efficiency multimodal model with strong tool execution.',
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash (Latest)',
    tag: 'AUTO LATEST',
    description: 'Always routes to the latest stable Google Flash model release.',
  },
];

export const DEFAULT_MODEL = AVAILABLE_MODELS[0];
export const ENFORCED_MODEL = AVAILABLE_MODELS[0];
