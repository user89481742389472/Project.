import React, { useState, useRef, useEffect } from 'react';
import { Message, ImageAttachment, AVAILABLE_MODELS, ModelOption } from './types';

export default function App() {
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('plain_chat_model') || 'gemini-3.7-flash';
  });

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      content: 'Welcome to the basic chat interface. This is a text-based communication tool with zero decorative elements. Select your preferred Gemini model above to optimize for speed, intelligence, or cost.',
      timestamp: Date.now(),
      modelUsed: 'gemini-3.7-flash',
    },
  ]);

  const [input, setInput] = useState('');
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<{ text: string; images: ImageAttachment[] } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentModelOption: ModelOption =
    AVAILABLE_MODELS.find((m) => m.id === selectedModel) || AVAILABLE_MODELS[0];

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    localStorage.setItem('plain_chat_model', modelId);
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getModelName = (modelId?: string) => {
    if (!modelId) return 'Gemini';
    const found = AVAILABLE_MODELS.find((m) => m.id === modelId);
    return found ? found.name : modelId;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

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
      modelUsed: selectedModel,
    };

    setMessages((prev) => [...prev, botPlaceholder]);

    try {
      abortControllerRef.current = new AbortController();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
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

        if (isRefusalText(rawErrMsg)) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === botMessageId
                ? { ...msg, content: 'I am sorry, but I cannot assist with that request.', modelUsed: selectedModel }
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
              } else if (parsed.text) {
                botText += parsed.text;
                const usedModel = parsed.model || selectedModel;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === botMessageId ? { ...msg, content: botText, modelUsed: usedModel } : msg
                  )
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

      // If no text was received at all, treat as refusal or provide polite response
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
      className="min-h-screen bg-white text-black font-mono flex items-center justify-center p-0 md:p-6 lg:p-8"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Main container */}
      <div
        id="main-container"
        className="relative flex flex-col h-screen md:h-[880px] w-full max-w-5xl bg-white text-black font-mono border-0 md:border-[16px] border-black shadow-none overflow-hidden"
      >
        {/* Drag Overlay */}
        {isDragging && (
          <div
            id="drag-drop-overlay"
            className="absolute inset-0 bg-white/95 z-50 border-8 border-dashed border-black flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="text-2xl sm:text-4xl font-black uppercase tracking-widest mb-2">
              [DROP IMAGE FILES HERE]
            </div>
            <p className="text-sm uppercase font-bold text-black tracking-wider">
              PNG, JPG, WEBP, GIF SUPPORTED (MAX 10MB)
            </p>
          </div>
        )}

        {/* Header */}
        <header id="app-header" className="border-b-4 border-black p-4 sm:p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 bg-white flex-shrink-0">
          <div>
            <h1 id="app-title" className="text-lg sm:text-xl md:text-2xl font-black uppercase tracking-tighter">
              Plain Chatbot Interface v1.0
            </h1>
            <div className="text-[11px] uppercase font-bold text-neutral-600 mt-0.5">
              Active Engine: <span className="text-black bg-neutral-100 px-1 border border-black">{currentModelOption.name}</span>
            </div>
          </div>
          <div id="header-controls" className="flex flex-wrap items-center gap-2 sm:gap-3 w-full md:w-auto justify-between md:justify-end">
            <div
              id="status-indicator"
              className="text-xs font-bold border-2 border-black px-2.5 py-1 uppercase"
            >
              STATUS: {isLoading ? 'PROCESSING' : 'ONLINE'}
            </div>
            <button
              id="clear-chat-btn"
              type="button"
              onClick={handleClearChat}
              className="border-2 border-black bg-white text-black px-3 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white transition-colors cursor-pointer"
            >
              CLEAR CHAT
            </button>
          </div>
        </header>

        {/* Model Selector Bar */}
        <section id="model-selection-bar" className="border-b-4 border-black bg-neutral-100 p-3 sm:px-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor="model-selector-dropdown" className="text-xs font-black uppercase tracking-wider text-black whitespace-nowrap">
              SELECT AI MODEL:
            </label>
            <select
              id="model-selector-dropdown"
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={isLoading}
              className="border-2 border-black bg-white text-black text-xs font-bold font-mono uppercase px-2.5 py-1.5 focus:outline-none cursor-pointer"
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model.id} value={model.id} className="font-mono text-xs">
                  {model.name} — [{model.tag}]
                </option>
              ))}
            </select>
          </div>
          <div id="model-description-pill" className="text-[11px] font-bold uppercase text-neutral-700 sm:text-right">
            {currentModelOption.description}
          </div>
        </section>

        {/* Main Chat Content Area */}
        <main id="chat-window" className="flex-1 flex flex-col overflow-hidden bg-white">
          <div className="flex-1 p-4 sm:p-8 overflow-y-auto space-y-6 sm:space-y-8">
            {messages.length === 0 && (
              <div id="empty-state" className="border-2 border-dashed border-black p-8 text-center text-xs uppercase font-bold tracking-widest my-8">
                NO ACTIVE CONVERSATION. SUBMIT INPUT BELOW TO INITIALIZE.
                <div className="mt-2 text-neutral-500 font-normal">
                  (Attach images via click or drag-and-drop to analyze them)
                </div>
              </div>
            )}

            {messages.map((message) => {
              const isUser = message.role === 'user';
              const formattedTime = formatTimestamp(message.timestamp);
              const hasImages = message.images && message.images.length > 0;
              const modelLabel = !isUser ? getModelName(message.modelUsed) : '';

              return (
                <div
                  key={message.id}
                  id={`message-${message.id}`}
                  className={`max-w-2xl ${isUser ? 'ml-auto text-right' : 'mr-auto text-left'}`}
                >
                  <div
                    id={`sender-label-${message.id}`}
                    className="text-xs uppercase font-bold mb-1 text-black tracking-wide"
                  >
                    {isUser ? `[User - ${formattedTime}]` : `[System (${modelLabel}) - ${formattedTime}]`}
                  </div>

                  {/* Attached images in message */}
                  {hasImages && (
                    <div className={`mb-2 flex flex-wrap gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                      {message.images!.map((img) => (
                        <div
                          key={img.id}
                          id={`image-container-${img.id}`}
                          onClick={() => setSelectedPreviewImage(img.data)}
                          className="border-2 sm:border-4 border-black p-1 bg-white cursor-pointer hover:opacity-90 transition-opacity"
                          title="Click to expand image"
                        >
                          <img
                            src={img.data}
                            alt={img.name}
                            className="h-28 w-auto max-w-[200px] object-cover border border-black"
                            referrerPolicy="no-referrer"
                          />
                          <div className="text-[10px] uppercase font-bold tracking-tight text-black truncate max-w-[190px] pt-1">
                            {img.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    id={`content-${message.id}`}
                    className={`border-2 sm:border-4 border-black p-4 text-sm sm:text-base whitespace-pre-wrap leading-relaxed font-mono ${
                      isUser
                        ? 'bg-black text-white inline-block text-left'
                        : 'bg-white text-black block text-left'
                    }`}
                  >
                    {message.content || (isLoading ? 'PROCESSING RESPONSE...' : '')}
                  </div>
                </div>
              );
            })}

            {error && (
              <div id="error-banner" className="border-4 border-black p-4 bg-white text-black text-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <div className="font-bold uppercase tracking-wider mb-1 text-red-600">[SYSTEM NOTICE / ERROR]</div>
                  <div className="font-mono">{error}</div>
                </div>
                {lastFailedMessage && !isLoading && (
                  <button
                    id="retry-last-msg-btn"
                    type="button"
                    onClick={() => {
                      setInput(lastFailedMessage.text === '[Attached image(s)]' ? '' : lastFailedMessage.text);
                      setAttachedImages(lastFailedMessage.images);
                      setError(null);
                    }}
                    className="bg-black text-white hover:bg-white hover:text-black border-2 border-black px-4 py-2 text-xs font-bold uppercase cursor-pointer whitespace-nowrap"
                  >
                    [RELOAD INPUT TO RETRY]
                  </button>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input control panel */}
          <div id="chat-input-panel" className="p-4 sm:p-6 border-t-4 border-black bg-white flex-shrink-0">
            <form id="chat-form" onSubmit={handleSendMessage} className="flex flex-col gap-3 sm:gap-4">
              <div className="flex justify-between items-center">
                <label htmlFor="message-input-field" className="text-xs font-bold uppercase tracking-wider text-black">
                  Enter Text Input & Attachments Below:
                </label>
                <span className="text-[10px] uppercase font-bold text-neutral-600 hidden sm:inline">
                  Drag & Drop or click + IMAGE
                </span>
              </div>

              {/* Active attached images pending send */}
              {attachedImages.length > 0 && (
                <div id="attached-images-preview" className="border-2 border-black p-2 bg-neutral-50 flex flex-wrap gap-3 items-center">
                  <div className="text-xs font-bold uppercase tracking-wider text-black pl-1">
                    ATTACHED ({attachedImages.length}):
                  </div>
                  {attachedImages.map((img) => (
                    <div
                      key={img.id}
                      id={`pending-img-${img.id}`}
                      className="flex items-center gap-2 border-2 border-black bg-white p-1"
                    >
                      <img
                        src={img.data}
                        alt={img.name}
                        className="h-10 w-10 object-cover border border-black cursor-pointer"
                        onClick={() => setSelectedPreviewImage(img.data)}
                      />
                      <div className="text-[10px] font-bold uppercase max-w-[120px] truncate text-black">
                        {img.name}
                      </div>
                      <button
                        id={`remove-img-${img.id}`}
                        type="button"
                        onClick={() => removeAttachedImage(img.id)}
                        className="bg-black text-white hover:bg-white hover:text-black border border-black px-1.5 py-0.5 text-xs font-bold uppercase cursor-pointer"
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

              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <input
                  id="message-input-field"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={attachedImages.length > 0 ? "ADD A PROMPT FOR THE IMAGE(S)..." : `TYPE YOUR MESSAGE (${currentModelOption.name})...`}
                  disabled={isLoading}
                  className="flex-1 border-4 border-black p-3 sm:p-4 text-base sm:text-xl font-mono uppercase bg-white text-black focus:outline-none placeholder:text-neutral-400"
                />

                {/* Image Attach Button */}
                <button
                  id="attach-image-btn"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                  className="bg-white text-black px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-bold uppercase hover:bg-black hover:text-white disabled:opacity-40 disabled:cursor-not-allowed border-4 border-black transition-colors cursor-pointer whitespace-nowrap"
                  title="Attach images"
                >
                  + IMAGE
                </button>

                {isLoading ? (
                  <button
                    id="stop-response-btn"
                    type="button"
                    onClick={handleStop}
                    className="bg-black text-white px-6 sm:px-12 py-3 sm:py-4 text-base sm:text-xl font-bold uppercase hover:bg-white hover:text-black border-4 border-black transition-colors cursor-pointer"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    id="send-message-btn"
                    type="submit"
                    disabled={!input.trim() && attachedImages.length === 0}
                    className="bg-black text-white px-6 sm:px-12 py-3 sm:py-4 text-base sm:text-xl font-bold uppercase hover:bg-white hover:text-black disabled:opacity-40 disabled:cursor-not-allowed border-4 border-black transition-colors cursor-pointer"
                  >
                    Send
                  </button>
                )}
              </div>

              <div id="input-metadata-footer" className="flex justify-between text-[10px] sm:text-xs uppercase font-bold tracking-wider text-black pt-1">
                <span>Model: {currentModelOption.name} [{currentModelOption.tag}]</span>
                <span className="hidden sm:inline">Characters: {input.length} {attachedImages.length > 0 ? `| Imgs: ${attachedImages.length}` : ''}</span>
                <span>Session: ACTIVE</span>
              </div>
            </form>
          </div>
        </main>

        {/* Footer banner */}
        <footer id="app-footer" className="bg-black text-white p-2 text-center text-[10px] uppercase tracking-[0.2em] font-mono flex-shrink-0">
          End of Interface Page
        </footer>
      </div>

      {/* Modal for full size image preview */}
      {selectedPreviewImage && (
        <div
          id="image-preview-modal"
          onClick={() => setSelectedPreviewImage(null)}
          className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4 cursor-pointer"
        >
          <div
            className="bg-white border-4 border-black p-4 max-w-4xl max-h-[90vh] flex flex-col items-center gap-3 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex justify-between items-center border-b-2 border-black pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-black">IMAGE VIEWER</span>
              <button
                id="close-modal-btn"
                type="button"
                onClick={() => setSelectedPreviewImage(null)}
                className="bg-black text-white px-2 py-1 text-xs font-bold uppercase border border-black hover:bg-white hover:text-black cursor-pointer"
              >
                [CLOSE ✕]
              </button>
            </div>
            <div className="overflow-auto max-h-[75vh] flex items-center justify-center p-2">
              <img
                src={selectedPreviewImage}
                alt="Expanded view"
                className="max-h-[70vh] max-w-full object-contain border-2 border-black"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
