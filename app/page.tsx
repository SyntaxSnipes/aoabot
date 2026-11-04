"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import demoFlight from "@/data/flights/demo-001.json";
import { rocketFacts, type FactStatus, type RocketFact } from "@/data/rocket-facts";

type FlightPoint = { time: number; altitude: number; pitch: number };
type FlightData = { flightId: string; isDemoData: boolean; points: FlightPoint[] };
type FlightStats = {
  flightId: string;
  isDemoData: boolean;
  apogee: { time: number; altitude: number };
};
type Message = {
  id: number;
  role: "bot" | "user";
  text: string;
  stats?: FlightStats;
};

const quickQuestions = [
  "Show flight demo-001",
  "What was our apogee?",
  "Why does pitch go negative after apogee?",
  "Is this real data?",
  "What are the safety rules?",
];

const initialMessages: Message[] = [{
  id: 1,
  role: "bot",
  text: "Hi! Ask about TeamAOA's water rocket, or replay a test flight.",
}];

function AoaLogo() {
  return <Image src="/AOALogo.svg" alt="" width={202} height={146} aria-hidden="true" />;
}

function DemoTag({ status }: { status: FactStatus }) {
  return status === "demo" ? <span className="demo-tag">DEMO</span> : null;
}

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 8-16 8 3.2-8L4 4Zm3.2 8h7.1" /></svg>;
}

function FlightPanel({
  flight,
}: {
  flight: FlightData;
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const maxAltitude = Math.max(...flight.points.map((item) => item.altitude), 1);
  const maxTime = Math.max(...flight.points.map((item) => item.time), 1);
  const chartWidth = 520;
  const chartHeight = 210;
  const pad = 30;
  const toX = (time: number) => pad + (time / maxTime) * (chartWidth - pad * 1.5);
  const toY = (altitude: number) => chartHeight - pad - (altitude / maxAltitude) * (chartHeight - pad * 1.7);
  const path = flight.points.map((item, pointIndex) => `${pointIndex ? "L" : "M"} ${toX(item.time)} ${toY(item.altitude)}`).join(" ");
  const apogee = flight.points.reduce((highest, item) => item.altitude > highest.altitude ? item : highest, flight.points[0]);
  const nextPoint = flight.points.find((item) => item.time >= currentTime) ?? flight.points[flight.points.length - 1];
  const previousPoint = flight.points[flight.points.indexOf(nextPoint) - 1] ?? nextPoint;
  const segmentLength = nextPoint.time - previousPoint.time;
  const segmentProgress = segmentLength === 0 ? 0 : (currentTime - previousPoint.time) / segmentLength;
  const point = {
    time: currentTime,
    altitude: previousPoint.altitude + (nextPoint.altitude - previousPoint.altitude) * segmentProgress,
    pitch: previousPoint.pitch + (nextPoint.pitch - previousPoint.pitch) * segmentProgress,
  };

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let previous = performance.now();
    const advance = (now: number) => {
      const elapsed = (now - previous) / 1000;
      previous = now;
      setCurrentTime((time) => {
        const nextTime = time + elapsed;
        if (nextTime >= maxTime) {
          setIsPlaying(false);
          return maxTime;
        }
        return nextTime;
      });
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, maxTime]);

  return (
    <div className="flight-panel" id="flight-panel">
      <div className="flight-heading">
        <div><p className="eyebrow">FLIGHT TELEMETRY</p><h2>{flight.flightId}</h2></div>
        {flight.isDemoData && <span className="demo-pill">DEMO DATA</span>}
      </div>
      <svg className="flight-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`Altitude over time for ${flight.flightId}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <line key={fraction} x1={pad} x2={chartWidth - pad / 2} y1={toY(maxAltitude * fraction)} y2={toY(maxAltitude * fraction)} className="chart-grid" />
        ))}
        <path d={path} className="altitude-line" />
        <circle cx={toX(apogee.time)} cy={toY(apogee.altitude)} r="5" className="apogee-marker" />
        <circle cx={toX(currentTime)} cy={toY(point.altitude)} r="5" className="playback-marker" />
        <text x={pad} y={chartHeight - 7}>0 s</text>
        <text x={chartWidth - pad / 2} y={chartHeight - 7} textAnchor="end">{maxTime.toFixed(1)} s</text>
        <text x={pad} y={16}>{maxAltitude} m</text>
      </svg>
      <input className="scrubber" type="range" min="0" max={maxTime} step="0.01" value={currentTime} onChange={(event) => { setCurrentTime(Number(event.target.value)); setIsPlaying(false); }} aria-label="Scrub flight playback" />
      <div className="flight-controls">
        <button type="button" onClick={() => { if (currentTime >= maxTime) setCurrentTime(0); setIsPlaying((playing) => !playing); }} aria-label={isPlaying ? "Pause flight playback" : "Play flight playback"}>{isPlaying ? "Ⅱ" : "▶"}</button>
        <span>{isPlaying ? "Playing" : "Paused"}</span>
      </div>
      <div className="flight-readouts">
        <div><span>TIME</span><strong>{point.time.toFixed(1)} s</strong></div>
        <div><span>ALTITUDE</span><strong>{point.altitude.toFixed(0)} m</strong></div>
        <div><span>PITCH</span><strong>{point.pitch.toFixed(0)}°</strong></div>
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedFlight, setSelectedFlight] = useState<FlightData>(demoFlight);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nextMessageId = useRef(2);
  const flightPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  const selectFlight = (flightId?: string) => {
    if (flightId === "demo-001") {
      setSelectedFlight(demoFlight);
      window.setTimeout(() => flightPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    }
  };

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
        body: JSON.stringify({ messages: history.slice(-30).map(({ role, text }) => ({ role: role === "bot" ? "assistant" : "user", content: text })) }),
      });
      const result = await response.json() as { message?: string; error?: string; showSimulation?: { flightId?: string }; flightStats?: FlightStats };
      if (!response.ok || !result.message) throw new Error(result.error ?? "AOABot could not answer right now.");
      selectFlight(result.showSimulation?.flightId);
      setMessages((current) => [...current, {
        id: nextMessageId.current++,
        role: "bot",
        text: result.message!,
        stats: result.flightStats,
      }]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function clearConversation() {
    if (isLoading) return;
    setMessages(initialMessages);
    nextMessageId.current = 2;
    setError("");
  }

  const snapshotFacts = useMemo(() => [
    ["BOTTLE", rocketFacts.bottle],
    ["LENGTH", rocketFacts.length],
    ["WATER LOAD", rocketFacts.waterLoad],
    ["LAUNCH ANGLE", rocketFacts.launchAngle],
  ] as ReadonlyArray<readonly [string, RocketFact<string | null>]>, []);

  return (
    <main className="app-shell">
      <section className="workspace" id="chat">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark"><AoaLogo /></div><strong>AOABot</strong></div>
          <div className="topbar-right"><span>TeamAOA · 2026</span><button className="clear-chat" onClick={clearConversation} disabled={isLoading}>Clear chat</button></div>
        </header>
        <div className="content-grid">
          <section className="chat-column">
            <div className="chat-heading"><h1>AOABot. Ask about TeamAOA&apos;s water rocket, or replay a test flight.</h1></div>
            <div className="messages" aria-live="polite" aria-busy={isLoading}>
              {messages.map((message) => (
                <div className={`message-row ${message.role} ${message.role === "bot" && /safety|goggles|pressur|authorized|rope/i.test(message.text) ? "safety-answer" : ""}`} key={message.id}>
                  {message.role === "bot" && <div className="tiny-avatar"><AoaLogo /></div>}
                  <div className="message-bubble"><p>{message.text}</p>{message.stats && <div className="computed-tag">Computed from {message.stats.flightId}{message.stats.isDemoData && " · Demo data"}</div>}<time>{message.role === "bot" ? "Answer" : "You"}</time></div>
                </div>
              ))}
              {isLoading && <div className="typing-indicator"><span /><span /><span /> Thinking…</div>}
              <div ref={messagesEndRef} />
            </div>
            <div className="quick-ask"><p>TRY ASKING</p><div>{quickQuestions.map((question) => <button key={question} onClick={() => submit(question)}>{question}</button>)}</div></div>
            <form className="composer" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submit(input); }}>
              <input aria-label="Ask about the water rocket" maxLength={2000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a question about our water rocket..." />
              <button aria-label="Send question" type="submit" disabled={isLoading}><SendIcon /></button>
            </form>
            {error && <p className="chat-error" role="alert">{error}</p>}
            <p className="disclaimer">Answers come from TeamAOA project data. Unconfirmed values are marked.</p>
          </section>
          <aside className="info-column">
            <div className="info-card snapshot"><div className="card-heading"><div><p className="eyebrow">AT A GLANCE</p><h2>Rocket snapshot</h2></div></div><div className="spec-grid">{snapshotFacts.map(([label, fact]) => <div key={label}><span>{label}</span><strong>{fact.value} <DemoTag status={fact.status} /></strong><small>{fact.note}</small></div>)}</div><div className="pressure-row"><span>LAUNCH PRESSURE</span><strong>{rocketFacts.launchPressure.value} <DemoTag status={rocketFacts.launchPressure.status} /><em> gauge</em></strong></div><div className="not-confirmed"><span className="warning-icon">!</span><span>Best measured range <strong>not yet determined</strong></span></div></div>
            <div ref={flightPanelRef}><FlightPanel key={selectedFlight.flightId} flight={selectedFlight} /></div>
            <div className="safety-strip" id="safety"><strong>Safety</strong><span>Goggles during pressurization</span><span>Stay 4.6 m (15 ft) behind the rope</span><span>Never handle a pressurized rocket</span><span>Inspect the bottle before launch</span><small>Only authorized people operate the pump and launcher.</small></div>
          </aside>
        </div>
      </section>
    </main>
  );
}
