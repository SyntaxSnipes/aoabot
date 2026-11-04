"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";

type Message = {
  id: number;
  role: "bot" | "user";
  text: string;
};

const quickQuestions = [
  "How does it fly?",
  "Tell me about the design",
  "What are the safety rules?",
  "Show our test data",
];

const initialMessages: Message[] = [
  {
    id: 1,
    role: "bot",
    text: "Hi! I’m AOABot, built by TeamAOA for the AUS NGN 110 Water Rocket Challenge 2026. Ask me about our rocket, the engineering behind it, test data, telemetry, safety, or sustainability.",
  },
];

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 4 16 8-16 8 3.2-8L4 4Zm3.2 8h7.1" />
    </svg>
  );
}

function AoaLogo() {
  return (
    <Image src="/AOALogo.svg" alt="" width={202} height={146} aria-hidden="true" />
  );
}

export default function Home() {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nextMessageId = useRef(2);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  async function submit(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;
    const userMessage = { id: nextMessageId.current++, role: "user" as const, text: trimmed };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput("");
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-30).map(({ role, text }) => ({
            role: role === "bot" ? "assistant" : "user",
            content: text,
          })),
        }),
      });
      const result = (await response.json()) as { message?: string; error?: string };
      if (!response.ok || !result.message) {
        throw new Error(result.error ?? "AOABot could not answer right now.");
      }
      setMessages((current) => [
        ...current,
        { id: nextMessageId.current++, role: "bot", text: result.message! },
      ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(input);
  }

  function clearConversation() {
    if (isLoading) return;
    setMessages(initialMessages);
    nextMessageId.current = 2;
    setError("");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><AoaLogo /></div>
          <div><strong>AOABot</strong><span>TeamAOA assistant</span></div>
        </div>
        <div className="side-section">
          <div className="side-label">PROJECT</div>
          <div className="project-card">
            <div className="project-icon"><AoaLogo /></div>
            <div><strong>Water Rocket</strong><span>AUS NGN 110 · 2026</span></div>
          </div>
        </div>
        <div className="sidebar-footer">
          <div className="status-dot" /> Demo mode
          <p>Team data is shown exactly as confirmed. Placeholder values are marked.</p>
        </div>
      </aside>

      <section className="workspace" id="chat">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark"><AoaLogo /></div><strong>AOABot</strong></div>
          <div className="topbar-right"><span className="online-dot" /> Online <span className="divider" /> <span>TeamAOA · 2026</span><button className="clear-chat" onClick={clearConversation} disabled={isLoading}>Clear chat</button></div>
        </header>
        <div className="content-grid">
          <section className="chat-column">
            <div className="chat-heading">
              <div><p className="eyebrow">YOUR PROJECT GUIDE</p><h1>Ask about the rocket<span className="orange-dot">.</span></h1><p className="subheading">Learn the science, see the data, and stay safe.</p></div>
              <div className="bot-badge"><div className="bot-avatar"><AoaLogo /></div><span>AOABot<br /><small>Ready to help</small></span></div>
            </div>
            <div className="messages" aria-live="polite" aria-busy={isLoading}>
              {messages.map((message) => (
                <div className={`message-row ${message.role}`} key={message.id}>
                  {message.role === "bot" && <div className="tiny-avatar"><AoaLogo /></div>}
                  <div className="message-bubble"><p>{message.text}</p><time>{message.role === "bot" ? "AOABot" : "You"}</time></div>
                </div>
              ))}
              {isLoading && <div className="typing-indicator"><span /><span /><span /> AOABot is thinking…</div>}
              <div ref={messagesEndRef} />
            </div>
            <div className="quick-ask">
              <p>TRY ASKING</p>
              <div>{quickQuestions.map((question) => <button key={question} onClick={() => submit(question)}>{question}</button>)}</div>
            </div>
            <form className="composer" onSubmit={handleSubmit}>
              <input aria-label="Ask AOABot a question" maxLength={2000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a question about our water rocket..." />
              <button aria-label="Send question" type="submit" disabled={isLoading}><SendIcon /></button>
            </form>
            {error && <p className="chat-error" role="alert">{error}</p>}
            <p className="disclaimer">AOABot answers from TeamAOA project data. If a value is not confirmed, we&apos;ll say so.</p>
          </section>

          <aside className="info-column">
            <div className="info-card snapshot" id="snapshot">
              <div className="card-heading"><div><p className="eyebrow">AT A GLANCE</p><h2>Rocket snapshot</h2></div><span className="flight-chip">DEMO</span></div>
              <div className="spec-grid">
                <div><span>BOTTLE</span><strong>1.5 L</strong><small>Reused PET</small></div>
                <div><span>LENGTH</span><strong>44 cm</strong><small>Under 50 cm limit</small></div>
                <div><span>WATER LOAD</span><strong>500 mL</strong><small>About ⅓ bottle</small></div>
                <div><span>LAUNCH ANGLE</span><strong>50°</strong><small>Demo value</small></div>
              </div>
              <div className="pressure-row"><span>LAUNCH PRESSURE</span><strong>5 bar <em>gauge</em></strong></div>
              <div className="not-confirmed"><span className="warning-icon">!</span><span>Best measured range <strong>not yet determined</strong></span></div>
            </div>
            <div className="info-card safety-card" id="safety">
              <div className="safety-title"><div className="shield">✓</div><div><p className="eyebrow">BEFORE EVERY LAUNCH</p><h2>Safety first</h2></div></div>
              <ul><li>Goggles on during pressurization</li><li>Stay behind the rope, 4.6 m (15 ft) away</li><li>Never handle a pressurized rocket</li><li>Inspect the bottle; retire damage</li></ul>
              <div className="authorized"><span className="lock">♢</span> Only authorized people operate the pump and launcher</div>
            </div>
            <div className="data-note"><div className="data-icon">⌁</div><div><strong>Telemetry ready</strong><p>ESP32 · barometer · IMU<br />Ask me what we measure.</p></div><span>→</span></div>
          </aside>
        </div>
      </section>
    </main>
  );
}
