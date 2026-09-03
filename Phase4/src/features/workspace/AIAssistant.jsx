import { useEffect, useRef, useState } from 'react';

export default function AIAssistant({ selected, onApplyCommand }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'AI Design Assistant ready. Select a part and say what you want to change.' },
  ]);
  const recognitionRef = useRef(null);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const submit = async (value = text) => {
    const command = value.trim();
    if (!command || busy) return;
    setMessages((m) => [...m, { role: 'user', text: command }]);
    setText('');
    setBusy(true);
    try {
      const res = await fetch('http://localhost:8787/api/ai/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI service unavailable');
      if (data.toolCall) onApplyCommand(data.toolCall);
      setMessages((m) => [...m, { role: 'assistant', text: data.explanation || 'Command processed.' }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `AI error: ${err.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const toggleVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages((m) => [...m, { role: 'assistant', text: 'Voice input is not supported in this browser. Use Chrome or Edge.' }]);
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setText(transcript);
      submit(transcript);
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <aside className="ai-panel">
      <div className="ai-panel__header">
        <div>
          <div className="ai-panel__title">AI Design Assistant</div>
          <div className="ai-panel__sub">Phase 3 · natural language + voice</div>
        </div>
        <span className="ai-badge">AI</span>
      </div>
      <div className="ai-panel__selected">
        <span>Selected part</span>
        <strong>{selected?.name || 'None — select a part first'}</strong>
      </div>
      <div className="ai-panel__messages">
        {messages.slice(-6).map((m, i) => (
          <div key={i} className={`ai-message ai-message--${m.role}`}>{m.text}</div>
        ))}
      </div>
      <div className="ai-panel__examples">
        <button onClick={() => submit('Increase the selected part size by 20%')}>+20% size</button>
        <button onClick={() => submit('Decrease the selected part size by 10%')}>-10% size</button>
        <button onClick={() => submit('Move the selected part slightly to the right')}>Move right</button>
      </div>
      <div className="ai-panel__input">
        <textarea
          value={text}
          rows={2}
          placeholder="e.g. increase the fan size by 20%"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />
        <div className="ai-panel__actions">
          <button className={`btn btn--voice${listening ? ' btn--voice-active' : ''}`} onClick={toggleVoice}>
            {listening ? '● Listening' : '🎙 Voice'}
          </button>
          <button className="btn btn--accent" disabled={busy || !text.trim()} onClick={() => submit()}>
            {busy ? 'Thinking…' : 'Run command'}
          </button>
        </div>
      </div>
    </aside>
  );
}
