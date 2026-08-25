import React, { useState, useRef, useEffect } from 'react';
import { Globe } from 'lucide-react';
import { Message, ImageAttachment, AVAILABLE_MODELS, DEFAULT_MODEL } from './types';

export default function App() {
  // User's personal Google Gemini API Key
  const [userApiKey, setUserApiKey] = useState<string>(() => {
    return localStorage.getItem('user_gemini_api_key') || '';
  });
  const [keyInput, setKeyInput] = useState<string>('');
  const [isValidatingKey, setIsValidatingKey] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  // Modal open on start if no key is saved
  const [isKeyModalOpen, setIsKeyModalOpen] = useState<boolean>(() => !localStorage.getItem('user_gemini_api_key'));

  // Active Model Selection
  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    return localStorage.getItem('user_gemini_model') || DEFAULT_MODEL.id;
  });

  const currentModel = AVAILABLE_MODELS.find((m) => m.id === selectedModelId) || DEFAULT_MODEL;

  const handleSelectModel = (modelId: string) => {
    setSelectedModelId(modelId);
    localStorage.setItem('user_gemini_model', modelId);
  };

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      content: 'Welcome to the plain chatbot interface. Available engines include Gemini 3.1 Flash Lite (Fastest & Max Quota), Gemini 3.7 Flash, and Gemini 3.5 Flash. All requests execute securely using your Google Gemini API key.',
      timestamp: Date.now(),
      modelUsed: DEFAULT_MODEL.name,
    },
  ]);

  const [input, setInput] = useState('');
  const [useGoogleSearch, setUseGoogleSearch] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<{ text: string; images: ImageAttachment[] } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // If no API key is present, lock the modal open
  useEffect(() => {
    if (!userApiKey) {
      setIsKeyModalOpen(true);
    }
  }, [userApiKey]);

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const maskApiKey = (key: string) => {
    if (!key || key.length < 8) return '****';
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Key validation & save handler
  const handleSaveKey = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setKeyError('Please enter your Google Gemini API key.');
      return;
    }

    setIsValidatingKey(true);
    setKeyError(null);

    try {
      const response = await fetch('/api/validate-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-api-key': trimmed,
        },
        body: JSON.stringify({ apiKey: trimmed }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.valid) {
        throw new Error(data.error || 'The provided key is invalid or unauthorized.');
      }

      // Valid key: Save to state & storage
      setUserApiKey(trimmed);
      localStorage.setItem('user_gemini_api_key', trimmed);
      setKeyInput('');
      setIsKeyModalOpen(false);
      setKeyError(null);
      setError(null);
    } catch (err: any) {
      setKeyError(err.message || 'Key validation failed. Please check your Google AI Studio key.');
    } finally {
      setIsValidatingKey(false);
    }
  };

  const handleDisconnectKey = () => {
    if (isLoading) handleStop();
    setUserApiKey('');
    localStorage.removeItem('user_gemini_api_key');
    setKeyInput('');
    setIsKeyModalOpen(true);
  };

  // Convert File to base64 ImageAttachment
  const processFile = (file: File): Promise<ImageAttachment> => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error(`File ${file.name} is not an image.`));
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error(`Image ${file.name} exceeds 10MB limit.`));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          mimeType: file.type,
          data: reader.result as string,
          size: file.size,
        });
      };
      reader.onerror = () => reject(new Error(`Failed to read file ${file.name}`));
      reader.readAsDataURL(file);
    });
  };

  const handleFiles = async (files: FileList | File[]) => {
    if (!userApiKey) {
      setIsKeyModalOpen(true);
      return;
    }
    const fileArray = Array.from(files);
    const imageFiles = fileArray.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setError('Please select valid image files (PNG, JPG, WEBP, GIF).');
      return;
    }

    try {
      const newAttachments = await Promise.all(imageFiles.map(processFile));
      setAttachedImages((prev) => [...prev, ...newAttachments]);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to process selected image(s).');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  };

  const removeAttachedImage = (id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
  };

  const isRefusalText = (txt: string) => {
    const lower = txt.toLowerCase();
    return (
      lower.includes('cannot assist') ||
      lower.includes('unable to assist') ||
      lower.includes('safety') ||
      lower.includes('prohibited') ||
      lower.includes('policy') ||
      lower.includes('blocked')
    );
  };

  const handleSendMessage = async (
    e?: React.FormEvent,
    overrideInput?: string,
    overrideImages?: ImageAttachment[]
  ) => {
    if (e) e.preventDefault();

    if (!userApiKey) {
      setIsKeyModalOpen(true);
      setError('A Google Gemini API key is strictly required to consume your own account quota.');
      return;
    }

    const currentText = overrideInput !== undefined ? overrideInput : input;
    const currentImgs = overrideImages !== undefined ? overrideImages : attachedImages;

    if ((!currentText.trim() && currentImgs.length === 0) || isLoading) return;

    const userText = currentText.trim() || (currentImgs.length > 0 ? '[Attached image(s)]' : '');
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userText,
      images: currentImgs.length > 0 ? [...currentImgs] : undefined,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setAttachedImages([]);
    setError(null);
    setLastFailedMessage(null);
    setIsLoading(true);

    const botMessageId = `bot-${Date.now()}`;
    const botPlaceholder: Message = {
      id: botMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      modelUsed: currentModel.name,
    };

    setMessages((prev) => [...prev, botPlaceholder]);

    try {
      abortControllerRef.current = new AbortController();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-api-key': userApiKey,
        },
        body: JSON.stringify({
          model: selectedModelId,
          useGoogleSearch,
          messages: newMessages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            content: m.content,
            images: m.images?.map((img) => ({
              mimeType: img.mimeType,
              data: img.data,
            })),
          })),
        }),
        signal: abortControllerRef.current.signal,
      });

      // Handle non-200 responses
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const rawErrMsg = errorData.error || errorData.text || `Server responded with status ${response.status}`;

        if (response.status === 401) {
          setIsKeyModalOpen(true);
        }

        if (isRefusalText(rawErrMsg)) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === botMessageId
                ? { ...msg, content: 'I am sorry, but I cannot assist with that request.', modelUsed: currentModel.name }
                : msg
            )
          );
          return;
        }

        throw new Error(rawErrMsg);
      }

      if (!response.body) {
        throw new Error('No response stream received from server');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let botText = '';
      let buffer = '';
      let streamHadError: string | null = null;
      let activeEngineName = currentModel.name;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') {
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                streamHadError = parsed.error;
              } else {
                if (parsed.text) botText += parsed.text;
                if (parsed.model) {
                  activeEngineName =
                    AVAILABLE_MODELS.find((m) => m.id === parsed.model)?.name || parsed.model;
                }
                
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id === botMessageId) {
                      const updatedMsg = { ...msg, content: botText, modelUsed: activeEngineName };
                      if (parsed.groundingSources && parsed.groundingSources.length > 0) {
                        updatedMsg.groundingSources = [
                          ...(msg.groundingSources || []),
                          ...parsed.groundingSources,
                        ];
                      }
                      return updatedMsg;
                    }
                    return msg;
                  })
                );
              }
            } catch (err: any) {
              // Ignore partial JSON parse errors in stream
            }
          }
        }
      }

      // If stream explicitly sent an error
      if (streamHadError) {
        if (isRefusalText(streamHadError)) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === botMessageId
                ? { ...msg, content: 'I am sorry, but I cannot assist with that request.' }
                : msg
            )
          );
          return;
        } else {
          throw new Error(streamHadError);
        }
      }

      // If no text was received at all, treat as refusal
      if (!botText.trim()) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMessageId
              ? { ...msg, content: 'I am sorry, but I cannot assist with that request.' }
              : msg
          )
        );
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMessageId && !msg.content
              ? { ...msg, content: '[Generation stopped by user]' }
              : msg
          )
        );
      } else {
        console.error('Chat error:', err);
        const errMsg = String(err.message || err);

        if (isRefusalText(errMsg)) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === botMessageId
                ? { ...msg, content: 'I am sorry, but I cannot assist with that request.' }
                : msg
            )
          );
        } else {
          setError(errMsg || 'An error occurred while getting response.');
          setMessages((prev) => prev.filter((msg) => msg.id !== botMessageId));
          setLastFailedMessage({ text: userText, images: currentImgs });
          if (currentImgs.length > 0) {
            setAttachedImages(currentImgs);
          }
        }
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleClearChat = () => {
    if (isLoading) handleStop();
    setMessages([]);
    setAttachedImages([]);
    setLastFailedMessage(null);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Drag & Drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      id="main-viewport"
      className="fixed inset-0 h-[100dvh] w-full bg-white text-black font-mono flex items-center justify-center p-0 sm:p-3 md:p-6 overflow-hidden select-text"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Main container: Full viewport on mobile, bounded card on desktop */}
      <div
        id="main-container"
        className="relative flex flex-col h-full w-full max-w-5xl bg-white text-black font-mono border-0 sm:border-4 md:border-[12px] border-black shadow-none overflow-hidden"
      >
        {/* Drag Overlay */}
        {isDragging && (
          <div
            id="drag-drop-overlay"
            className="absolute inset-0 bg-white/95 z-50 border-4 sm:border-8 border-dashed border-black flex flex-col items-center justify-center p-4 sm:p-6 text-center"
          >
            <div className="text-xl sm:text-3xl font-black uppercase tracking-widest mb-2">
              [DROP IMAGE FILES HERE]
            </div>
            <p className="text-xs sm:text-sm uppercase font-bold text-black tracking-wider">
              PNG, JPG, WEBP, GIF SUPPORTED (MAX 10MB)
            </p>
          </div>
        )}

        {/* Compact, responsive Header */}
        <header
          id="app-header"
          className="border-b-2 sm:border-b-4 border-black p-2.5 sm:p-4 flex flex-col gap-2 bg-white flex-shrink-0"
        >
          <div className="flex items-center justify-between gap-2">
            <h1
              id="app-title"
              className="text-sm sm:text-lg md:text-xl font-black uppercase tracking-tighter truncate"
            >
              Plain Chatbot
            </h1>

            <div id="header-controls" className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <button
                id="manage-key-btn"
                type="button"
                onClick={() => {
                  setKeyInput(userApiKey);
                  setIsKeyModalOpen(true);
                  setKeyError(null);
                }}
                className="border sm:border-2 border-black bg-black text-white px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-bold uppercase hover:bg-white hover:text-black transition-colors cursor-pointer min-h-[36px] sm:min-h-[40px] flex items-center justify-center whitespace-nowrap"
              >
                {userApiKey ? '⚙️ KEY' : '🔑 CONNECT KEY'}
              </button>

              <button
                id="clear-chat-btn"
                type="button"
                onClick={handleClearChat}
                className="border sm:border-2 border-black bg-white text-black px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-bold uppercase hover:bg-black hover:text-white transition-colors cursor-pointer min-h-[36px] sm:min-h-[40px] flex items-center justify-center"
              >
                CLEAR
              </button>
            </div>
          </div>

          {/* Model & Quota Status Sub-bar */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] sm:text-[11px] font-bold uppercase bg-neutral-50 p-1.5 border border-black">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-neutral-500">ENGINE:</span>
              <select
                id="model-selector-dropdown"
                value={selectedModelId}
                onChange={(e) => handleSelectModel(e.target.value)}
                className="bg-white text-black font-black font-mono border-2 border-black px-1.5 py-0.5 text-[10px] sm:text-[11px] uppercase cursor-pointer focus:outline-none hover:bg-neutral-100"
              >
                {AVAILABLE_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} [{model.tag}]
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-neutral-500">QUOTA:</span>
              {userApiKey ? (
                <span className="bg-black text-white px-1.5 py-0.5 border border-black font-mono">
                  USER [{maskApiKey(userApiKey)}]
                </span>
              ) : (
                <span className="bg-red-600 text-white px-1.5 py-0.5 border border-black animate-pulse">
                  KEY REQUIRED
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Main Chat Content Area: Scrollable and fits mobile viewport */}
        <main
          id="chat-window"
          className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white relative"
        >
          {/* Key Requirement Warning Overlay if no key is configured */}
          {!userApiKey && (
            <div
              id="no-key-banner"
              className="bg-neutral-900 text-white p-2.5 sm:p-3 border-b-2 sm:border-b-4 border-black flex flex-col sm:flex-row justify-between items-center gap-2 z-10 flex-shrink-0"
            >
              <div className="text-[11px] sm:text-xs font-bold uppercase tracking-wide text-center sm:text-left">
                ⚠️ GOOGLE ACCOUNT GEMINI API KEY REQUIRED
              </div>
              <button
                id="connect-key-banner-btn"
                type="button"
                onClick={() => {
                  setKeyInput('');
                  setIsKeyModalOpen(true);
                  setKeyError(null);
                }}
                className="bg-white text-black hover:bg-neutral-200 border-2 border-white px-3 py-1 text-[11px] font-black uppercase whitespace-nowrap cursor-pointer min-h-[36px] flex items-center justify-center"
              >
                [ENTER GOOGLE KEY]
              </button>
            </div>
          )}

          {/* Messages list */}
          <div className="flex-1 min-h-0 p-3 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 overscroll-contain">
            {messages.length === 0 && (
              <div
                id="empty-state"
                className="border-2 border-dashed border-black p-4 sm:p-8 text-center text-xs uppercase font-bold tracking-widest my-4"
              >
                NO ACTIVE CONVERSATION. SUBMIT INPUT BELOW TO INITIALIZE.
                <div className="mt-1 sm:mt-2 text-neutral-500 font-normal">
                  (Attach images via + IMAGE or drag-and-drop to analyze)
                </div>
              </div>
            )}

            {messages.map((message) => {
              const isUser = message.role === 'user';
              const formattedTime = formatTimestamp(message.timestamp);
              const hasImages = message.images && message.images.length > 0;

              return (
                <div
                  key={message.id}
                  id={`message-${message.id}`}
                  className={`max-w-[92%] sm:max-w-xl md:max-w-2xl ${
                    isUser ? 'ml-auto text-right' : 'mr-auto text-left'
                  }`}
                >
                  <div
                    id={`sender-label-${message.id}`}
                    className="text-[10px] sm:text-xs uppercase font-bold mb-1 text-black tracking-wide"
                  >
                    {isUser
                      ? `[User - ${formattedTime}]`
                      : `[System (${message.modelUsed || currentModel.name}) - ${formattedTime}]`}
                  </div>

                  {/* Attached images in message */}
                  {hasImages && (
                    <div
                      className={`mb-1.5 sm:mb-2 flex flex-wrap gap-1.5 sm:gap-2 ${
                        isUser ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {message.images!.map((img) => (
                        <div
                          key={img.id}
                          id={`image-container-${img.id}`}
                          onClick={() => setSelectedPreviewImage(img.data)}
                          className="border-2 border-black p-1 bg-white cursor-pointer hover:opacity-90 transition-opacity"
                          title="Click to expand image"
                        >
                          <img
                            src={img.data}
                            alt={img.name}
                            className="h-20 sm:h-28 w-auto max-w-[150px] sm:max-w-[200px] object-cover border border-black"
                            referrerPolicy="no-referrer"
                          />
                          <div className="text-[9px] sm:text-[10px] uppercase font-bold tracking-tight text-black truncate max-w-[140px] sm:max-w-[190px] pt-0.5">
                            {img.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    id={`content-${message.id}`}
                    className={`border-2 sm:border-4 border-black p-2.5 sm:p-4 text-xs sm:text-base whitespace-pre-wrap leading-relaxed font-mono break-words ${
                      isUser
                        ? 'bg-black text-white inline-block text-left'
                        : 'bg-white text-black block text-left'
                    }`}
                  >
                    {message.content || (isLoading ? 'PROCESSING RESPONSE...' : '')}
                  </div>

                  {!isUser && message.groundingSources && message.groundingSources.length > 0 && (
                    <div className="mt-2 text-left bg-neutral-100 border-2 border-black p-2 sm:p-3 text-[10px] sm:text-xs">
                      <div className="font-bold uppercase mb-1 flex items-center gap-1">
                        <Globe className="w-3 h-3 sm:w-4 sm:h-4 inline" /> 
                        Google Search Sources:
                      </div>
                      <ul className="list-disc pl-4 space-y-1">
                        {message.groundingSources.map((source, idx) => (
                          <li key={idx} className="truncate">
                            <a 
                              href={source.uri} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline font-bold"
                            >
                              {source.title || source.uri}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}

            {error && (
              <div
                id="error-banner"
                className="border-2 sm:border-4 border-black p-3 sm:p-4 bg-white text-black text-xs sm:text-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2"
              >
                <div>
                  <div className="font-bold uppercase tracking-wider mb-0.5 text-red-600">
                    [SYSTEM NOTICE / ERROR]
                  </div>
                  <div className="font-mono text-xs sm:text-sm break-words">{error}</div>
                </div>
                {lastFailedMessage && !isLoading && (
                  <button
                    id="retry-last-msg-btn"
                    type="button"
                    onClick={() => {
                      setInput(
                        lastFailedMessage.text === '[Attached image(s)]'
                          ? ''
                          : lastFailedMessage.text
                      );
                      setAttachedImages(lastFailedMessage.images);
                      setError(null);
                    }}
                    className="bg-black text-white hover:bg-white hover:text-black border-2 border-black px-3 py-1.5 text-xs font-bold uppercase cursor-pointer whitespace-nowrap min-h-[36px]"
                  >
                    [RETRY]
                  </button>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input control panel - Mobile optimized */}
          <div
            id="chat-input-panel"
            className="p-2.5 sm:p-4 border-t-2 sm:border-t-4 border-black bg-white flex-shrink-0"
          >
            <form id="chat-form" onSubmit={handleSendMessage} className="flex flex-col gap-2">
              {/* Active attached images pending send */}
              {attachedImages.length > 0 && (
                <div
                  id="attached-images-preview"
                  className="border-2 border-black p-1.5 bg-neutral-50 flex flex-wrap gap-2 items-center max-h-24 overflow-y-auto"
                >
                  <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-black pl-1">
                    ATTACHED ({attachedImages.length}):
                  </div>
                  {attachedImages.map((img) => (
                    <div
                      key={img.id}
                      id={`pending-img-${img.id}`}
                      className="flex items-center gap-1.5 border border-black bg-white p-0.5"
                    >
                      <img
                        src={img.data}
                        alt={img.name}
                        className="h-7 w-7 object-cover border border-black cursor-pointer"
                        onClick={() => setSelectedPreviewImage(img.data)}
                      />
                      <div className="text-[9px] font-bold uppercase max-w-[80px] sm:max-w-[120px] truncate text-black">
                        {img.name}
                      </div>
                      <button
                        id={`remove-img-${img.id}`}
                        type="button"
                        onClick={() => removeAttachedImage(img.id)}
                        className="bg-black text-white hover:bg-white hover:text-black border border-black px-1 text-[10px] font-bold uppercase cursor-pointer"
                        title="Remove image"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                id="image-file-input"
                type="file"
                accept="image/png, image/jpeg, image/webp, image/gif"
                multiple
                onChange={handleFileInputChange}
                className="hidden"
              />

              {/* Input Row: Input, Image Button, Send Button */}
              <div className="flex items-stretch gap-1.5 sm:gap-3">
                <input
                  id="message-input-field"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    !userApiKey
                      ? 'ENTER KEY TO UNLOCK...'
                      : attachedImages.length > 0
                      ? 'ADD PROMPT FOR IMAGE...'
                      : 'TYPE YOUR MESSAGE...'
                  }
                  disabled={isLoading || !userApiKey}
                  className="flex-1 min-w-0 border-2 sm:border-4 border-black p-2 sm:p-3 text-sm sm:text-base font-mono uppercase bg-white text-black focus:outline-none placeholder:text-neutral-400 disabled:bg-neutral-100 disabled:cursor-not-allowed min-h-[44px]"
                />

                {/* Search Grounding Toggle */}
                <button
                  id="search-toggle-btn"
                  type="button"
                  onClick={() => setUseGoogleSearch(!useGoogleSearch)}
                  disabled={isLoading}
                  className={`px-2.5 sm:px-4 py-2 text-xs sm:text-sm font-bold uppercase transition-colors cursor-pointer whitespace-nowrap min-h-[44px] flex items-center justify-center flex-shrink-0 border-2 sm:border-4 border-black disabled:opacity-40 disabled:cursor-not-allowed ${
                    useGoogleSearch
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-white text-black hover:bg-black hover:text-white'
                  }`}
                  title={useGoogleSearch ? 'Google Search Grounding: ON' : 'Google Search Grounding: OFF'}
                >
                  <Globe className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                {/* Image Attach Button */}
                <button
                  id="attach-image-btn"
                  type="button"
                  onClick={() => {
                    if (!userApiKey) {
                      setIsKeyModalOpen(true);
                      return;
                    }
                    fileInputRef.current?.click();
                  }}
                  disabled={isLoading}
                  className="bg-white text-black px-2.5 sm:px-4 py-2 text-xs sm:text-sm font-bold uppercase hover:bg-black hover:text-white disabled:opacity-40 disabled:cursor-not-allowed border-2 sm:border-4 border-black transition-colors cursor-pointer whitespace-nowrap min-h-[44px] flex items-center justify-center flex-shrink-0"
                  title="Attach images"
                >
                  📷 <span className="hidden sm:inline sm:ml-1">+ IMAGE</span>
                </button>

                {isLoading ? (
                  <button
                    id="stop-response-btn"
                    type="button"
                    onClick={handleStop}
                    className="bg-black text-white px-3 sm:px-6 py-2 text-xs sm:text-base font-bold uppercase hover:bg-white hover:text-black border-2 sm:border-4 border-black transition-colors cursor-pointer min-h-[44px] flex items-center justify-center flex-shrink-0"
                  >
                    STOP
                  </button>
                ) : (
                  <button
                    id="send-message-btn"
                    type="submit"
                    disabled={(!input.trim() && attachedImages.length === 0) || !userApiKey}
                    className="bg-black text-white px-3 sm:px-8 py-2 text-xs sm:text-base font-bold uppercase hover:bg-white hover:text-black disabled:opacity-40 disabled:cursor-not-allowed border-2 sm:border-4 border-black transition-colors cursor-pointer min-h-[44px] flex items-center justify-center flex-shrink-0"
                  >
                    SEND
                  </button>
                )}
              </div>

              <div
                id="input-metadata-footer"
                className="flex justify-between text-[9px] sm:text-[11px] uppercase font-bold tracking-wider text-black pt-0.5"
              >
                <span>{currentModel.name} [{currentModel.tag}]</span>
                <span>QUOTA: {userApiKey ? 'USER ACCOUNT' : 'BLOCKED'}</span>
              </div>
            </form>
          </div>
        </main>

        {/* Footer banner */}
        <footer
          id="app-footer"
          className="bg-black text-white py-1 px-2 text-center text-[9px] sm:text-[10px] uppercase tracking-[0.15em] font-mono flex-shrink-0"
        >
          Plain Chatbot Interface • Mobile Ready
        </footer>
      </div>

      {/* Google Account / Gemini API Key Modal - Mobile friendly */}
      {isKeyModalOpen && (
        <div
          id="key-config-modal-backdrop"
          className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => {
            if (userApiKey) setIsKeyModalOpen(false);
          }}
        >
          <div
            id="key-config-modal-card"
            className="bg-white border-4 sm:border-8 border-black p-4 sm:p-6 max-w-lg w-full flex flex-col gap-3 cursor-default shadow-none font-mono my-auto max-h-[95dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b-2 sm:border-b-4 border-black pb-2">
              <h2 className="text-sm sm:text-base font-black uppercase tracking-tight text-red-600">
                [GOOGLE KEY REQUIRED]
              </h2>
              {userApiKey && (
                <button
                  id="close-key-modal-btn"
                  type="button"
                  onClick={() => setIsKeyModalOpen(false)}
                  className="bg-black text-white px-2 py-1 text-xs font-bold uppercase border border-black hover:bg-white hover:text-black cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="text-[11px] sm:text-xs space-y-2 text-neutral-800 leading-relaxed font-mono">
              <p className="font-black uppercase text-black">
                To prevent burning server quota, please connect your personal Google Gemini API key.
              </p>
              <ul className="list-disc pl-4 space-y-1 text-[11px] sm:text-xs text-black">
                <li>
                  <strong>Engines:</strong> Choose between <strong>Gemini 3.1 Flash Lite</strong>, <strong>Gemini 3.7 Flash</strong>, and <strong>Gemini 3.5 Flash</strong>.
                </li>
                <li>
                  <strong>Quota:</strong> 100% runs on your own personal Google account free tier quota.
                </li>
              </ul>
            </div>

            <div className="bg-neutral-100 border-2 sm:border-4 border-black p-2.5 sm:p-3 text-[11px] sm:text-xs">
              <span className="font-black uppercase block mb-1 text-black">Get your free key in seconds:</span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-black font-black underline uppercase hover:bg-black hover:text-white px-1 py-0.5 transition-colors inline-block text-[11px] sm:text-xs"
              >
                👉 Open Google AI Studio (Get Key) ↗
              </a>
            </div>

            <form onSubmit={handleSaveKey} className="flex flex-col gap-2.5 mt-1">
              <label
                htmlFor="user-api-key-input"
                className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-black"
              >
                Paste your Gemini API Key:
              </label>
              <input
                id="user-api-key-input"
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                disabled={isValidatingKey}
                autoFocus
                className="border-2 sm:border-4 border-black p-2.5 sm:p-3 text-xs sm:text-sm font-mono bg-white text-black focus:outline-none placeholder:text-neutral-400 font-bold min-h-[44px]"
              />

              {keyError && (
                <div
                  id="key-error-notice"
                  className="border-2 sm:border-4 border-red-600 bg-red-50 text-red-900 p-2 text-[11px] sm:text-xs font-bold uppercase break-words"
                >
                  [ERROR]: {keyError}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 justify-end pt-1">
                {userApiKey && (
                  <button
                    id="disconnect-key-btn"
                    type="button"
                    onClick={handleDisconnectKey}
                    disabled={isValidatingKey}
                    className="border-2 border-black bg-white text-red-600 px-3 py-2 text-xs font-bold uppercase hover:bg-red-600 hover:text-white transition-colors cursor-pointer min-h-[44px]"
                  >
                    DISCONNECT KEY
                  </button>
                )}
                <button
                  id="save-key-btn"
                  type="submit"
                  disabled={!keyInput.trim() || isValidatingKey}
                  className="border-2 sm:border-4 border-black bg-black text-white px-4 sm:px-6 py-2.5 text-xs sm:text-sm font-black uppercase hover:bg-white hover:text-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer min-h-[44px]"
                >
                  {isValidatingKey ? 'VERIFYING WITH GOOGLE...' : 'VERIFY & UNLOCK CHAT'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for full size image preview */}
      {selectedPreviewImage && (
        <div
          id="image-preview-modal"
          onClick={() => setSelectedPreviewImage(null)}
          className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-3 cursor-pointer"
        >
          <div
            className="bg-white border-2 sm:border-4 border-black p-3 max-w-4xl max-h-[90dvh] flex flex-col items-center gap-2 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex justify-between items-center border-b border-black pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-black">
                IMAGE VIEWER
              </span>
              <button
                id="close-modal-btn"
                type="button"
                onClick={() => setSelectedPreviewImage(null)}
                className="bg-black text-white px-2 py-1 text-[11px] font-bold uppercase border border-black hover:bg-white hover:text-black cursor-pointer min-h-[32px]"
              >
                [CLOSE ✕]
              </button>
            </div>
            <div className="overflow-auto max-h-[75dvh] flex items-center justify-center p-1">
              <img
                src={selectedPreviewImage}
                alt="Expanded view"
                className="max-h-[70dvh] max-w-full object-contain border border-black"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
