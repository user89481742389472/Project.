import React, { useState, useRef, useEffect } from 'react';
import { Message } from './types';

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      content: 'Hello. I am a basic chatbot. How can I help you today?',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userText,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setError(null);
    setIsLoading(true);

    const botMessageId = `bot-${Date.now()}`;
    const botPlaceholder: Message = {
      id: botMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
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
          messages: newMessages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            content: m.content,
          })),
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body returned from server');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let botText = '';
      let buffer = '';

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
                throw new Error(parsed.error);
              }
              if (parsed.text) {
                botText += parsed.text;
                setMessages((prev) =>
                  prev.map((msg) => (msg.id === botMessageId ? { ...msg, content: botText } : msg))
                );
              }
            } catch (err: any) {
              if (err.message && err.message !== 'Unexpected end of JSON input') {
                console.error('Error parsing SSE chunk:', err);
              }
            }
          }
        }
      }

      // If response ended up empty
      if (!botText.trim()) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMessageId
              ? { ...msg, content: 'No response was generated.' }
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
        setError(err.message || 'An error occurred while getting response.');
        setMessages((prev) => prev.filter((msg) => msg.id !== botMessageId));
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
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div id="main-container" className="min-h-screen bg-white text-black font-mono flex flex-col items-center">
      {/* Header */}
      <header id="app-header" className="w-full max-w-3xl border-b border-black p-4 flex justify-between items-center">
        <h1 id="app-title" className="text-xl font-bold tracking-tight">
          Basic Chatbot
        </h1>
        <div id="header-controls" className="flex items-center gap-3">
          <button
            id="clear-chat-btn"
            type="button"
            onClick={handleClearChat}
            className="border border-black bg-white text-black px-3 py-1 text-sm hover:bg-black hover:text-white transition-colors cursor-pointer"
          >
            Clear Chat
          </button>
        </div>
      </header>

      {/* Chat messages container */}
      <main id="chat-window" className="w-full max-w-3xl flex-1 p-4 flex flex-col gap-4 overflow-y-auto">
        {messages.length === 0 && (
          <div id="empty-state" className="text-neutral-500 text-sm my-auto text-center py-12">
            No messages. Type below to start a conversation.
          </div>
        )}

        {messages.map((message) => {
          const isUser = message.role === 'user';
          return (
            <div
              key={message.id}
              id={`message-${message.id}`}
              className={`p-3 border border-black ${isUser ? 'bg-white ml-8' : 'bg-neutral-50 mr-8'}`}
            >
              <div id={`sender-label-${message.id}`} className="text-xs font-bold uppercase mb-1 text-black">
                {isUser ? 'You' : 'Bot'}
              </div>
              <div id={`content-${message.id}`} className="text-sm text-black whitespace-pre-wrap leading-relaxed">
                {message.content || (isLoading ? '...' : '')}
              </div>
            </div>
          );
        })}

        {error && (
          <div id="error-banner" className="border border-black p-3 bg-white text-sm text-black">
            <span className="font-bold">Error: </span>
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Input container */}
      <footer id="chat-input-footer" className="w-full max-w-3xl border-t border-black p-4 bg-white">
        <form id="chat-form" onSubmit={handleSendMessage} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <textarea
              id="message-input-field"
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message here..."
              rows={2}
              className="flex-1 border border-black bg-white text-black p-2 text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
              disabled={isLoading}
            />

            {isLoading ? (
              <button
                id="stop-response-btn"
                type="button"
                onClick={handleStop}
                className="border border-black bg-white text-black px-4 py-2 text-sm font-bold hover:bg-black hover:text-white transition-colors cursor-pointer self-stretch flex items-center justify-center"
              >
                Stop
              </button>
            ) : (
              <button
                id="send-message-btn"
                type="submit"
                disabled={!input.trim()}
                className="border border-black bg-white text-black px-4 py-2 text-sm font-bold hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer self-stretch flex items-center justify-center"
              >
                Send
              </button>
            )}
          </div>

          <div id="input-help-text" className="text-xs text-neutral-500 flex justify-between">
            <span>Press Enter to send, Shift+Enter for newline</span>
            <span>{input.length} characters</span>
          </div>
        </form>
      </footer>
    </div>
  );
}
