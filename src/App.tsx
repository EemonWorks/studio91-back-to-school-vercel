import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  ArrowRight, Armchair, BookOpen, Cat, Check, CircleHelp,
  Download, Grid2X2, Link, LoaderCircle, Minus, MousePointer2,
  Plus, RotateCcw, School, Share2, Sparkles, Users, X,
} from 'lucide-react';
import {
  BENCHES_PER_ROW, COLUMNS, GROUPS, POLL_INTERVAL_MS, ROWS, SEAT_COUNT, SEATS_PER_BENCH,
  groupFor, newestSnapshot, pencilPose, rowFor, seatLabel, summarize,
} from './shared';
import type { ConnectionState, Room, SeatPoint } from './shared';
import Doodle from './Doodle';
import HostTools from './HostTools';
import SimulatedClassmates from './SimulatedClassmates';

const Classroom = lazy(() => import('./Classroom'));
const emptyVotes: Room['votes'] = [];
type Modal = 'results' | 'help' | 'name' | null;
type Profile = { token: string; name: string };
type SavedSeat = { epoch: string; seat: number };
const PROFILE_KEY = 'studio91.profile';
const SEAT_KEY = 'studio91.seat';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, body === undefined ? { signal: signal ?? null } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal ?? null,
    });
  } catch {
    throw new Error('Cannot reach the classroom. Check your connection and try again.');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('The classroom is not reachable right now. Please reload in a moment.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The classroom is unavailable. Try again.');
  return result as T;
}

// The seat you picked is remembered per "class" (the room's createdAt). When the
// host erases all seats, createdAt changes and everyone's old pick is forgotten.
function readSavedSeat(): SavedSeat | null {
  try {
    const raw = localStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && 'epoch' in value && typeof value.epoch === 'string' &&
      'seat' in value && typeof value.seat === 'number' && Number.isInteger(value.seat) &&
      value.seat >= 0 && value.seat < SEAT_COUNT) return { epoch: value.epoch, seat: value.seat };
    console.warn('The saved seat is invalid and will not be restored.');
  } catch (issue) {
    console.warn('The saved seat could not be restored:', issue);
  }
  return null;
}

function forgetSavedSeat() {
  try { localStorage.removeItem(SEAT_KEY); }
  catch (issue) { console.warn('The saved seat could not be removed:', issue); }
}

function ModalShell({ title, children, onClose, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="modal-heading">
    <button className="icon-button modal-close" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
    <h2 id="modal-heading">{title}</h2>
    {children}
  </dialog>;
}

function MicrosoftMark() {
  return <span className="ms-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}

function SeatMap({ counts, selected, heatmap, botSeats, onSelect }: {
  counts: number[]; selected: number | null; heatmap: boolean; botSeats: number[]; onSelect: (seat: number) => void;
}) {
  const max = Math.max(1, ...counts);
  return <div className="seat-map">
    <div className="map-board">
      <Doodle kind="hearts" medium="chalk" className="map-board-hearts" />
      <span>Welcome back, class of you.</span><small>CHALKBOARD / FRONT OF CLASS</small>
      <img className="map-board-star" src={`${import.meta.env.BASE_URL}visuals/chalk-star.webp`} alt="" aria-hidden="true" />
    </div>
    {Array.from({ length: ROWS }, (_, row) => <div className="map-row" key={row}>
      <span className="row-label">{String.fromCharCode(65 + row)}</span>
      {Array.from({ length: BENCHES_PER_ROW }, (_, bench) => {
        const firstSeat = row * COLUMNS + bench * SEATS_PER_BENCH;
        const pencilCount = (counts[firstSeat] ?? 0) + (counts[firstSeat + 1] ?? 0);
        return <div className={`map-bench bench-group-${groupFor(firstSeat)}`} key={bench} data-pencil-count={pencilCount}
          role="group" aria-label={`Two-person bench ${seatLabel(firstSeat)} and ${seatLabel(firstSeat + 1)}`}>
          {pencilCount > 0 && <div className="map-mound" aria-hidden="true">
            {Array.from({ length: pencilCount }, (_, index) => {
              const pose = pencilPose(index, pencilCount);
              return <i className="map-pencil" key={index} style={{ transform: `translate(${pose.z * 50 - 14}px, ${-(pose.y - 1.21) * 22}px) rotate(${pose.angle * 180 / Math.PI}deg)` }} />;
            })}
          </div>}
          {Array.from({ length: SEATS_PER_BENCH }, (_, side) => {
            const seat = firstSeat + side;
            const count = counts[seat] ?? 0;
            const visitorHere = botSeats.includes(seat);
            return <button key={seat} data-seat={seat}
              className={`map-desk ${selected === seat ? 'selected' : ''} ${visitorHere ? 'bot-hover' : ''}`}
              style={heatmap && count ? { background: `color-mix(in srgb, #e7337f ${30 + count / max * 70}%, #fff3a0)` } : undefined}
              aria-label={`Seat ${seatLabel(seat)}, row ${row + 1}, ${count} ${count === 1 ? 'person' : 'people'}`}
              aria-pressed={selected === seat} onClick={() => onSelect(seat)}>
              <span>{seatLabel(seat)}</span>{(count > 0 || selected === seat || visitorHere) && <Cat className={`map-cat ${selected === seat ? 'your-cat' : ''}`} size={18} />}
              {count > 0 && <b>{count}</b>}
            </button>;
          })}
        </div>;
      })}
    </div>)}
    <div className="map-back">20 BENCHES / 40 SEATS / ONE CLASS <Sparkles size={12} /></div>
  </div>;
}

function ResultsChart({ votes, large = false }: { votes: Room['votes']; large?: boolean }) {
  const { counts, total } = summarize(votes);
  return <div className={`results-chart ${large ? 'large' : ''}`}>
    {GROUPS.map((group, i) => {
      const count = counts[i] ?? 0;
      const percent = total ? Math.round(count / total * 100) : 0;
      return <div className="chart-row" key={group.name}>
        <div className="chart-label"><span><i style={{ background: group.color }} />{large ? group.name : group.short}</span><b>{count}<small>{large ? ` / ${percent}%` : ''}</small></b></div>
        <div className="chart-track"><div style={{ width: `${percent}%`, background: group.color }} /></div>
        {large && <p>{group.note} <span>Rows {i === 0 ? '1-2' : i === 1 ? '3' : '4-5'}</span></p>}
      </div>;
    })}
  </div>;
}

export default function App() {
  const [room, setRoom] = useState<Room | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [pendingSeat, setPendingSeat] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [botSeats, setBotSeats] = useState<number[]>([]);
  const [view, setView] = useState<'3d' | 'map'>('3d');
  const [heatmap, setHeatmap] = useState(false);
  const [reset, setReset] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const { counts, seats, total } = summarize(room?.votes ?? emptyVotes);
  const voteLock = useRef(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const seatPoints = useRef<SeatPoint[]>([]);
  const inviteLink = `${location.origin}${location.pathname}`;
  const receiveRoom = useCallback((next: Room) => {
    setRoom((current) => newestSnapshot(current, next));
  }, []);

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Old invite links (?room=ABC123) still work: they just land in the one classroom.
  useEffect(() => {
    if (!location.search) return;
    history.replaceState(null, '', location.pathname);
  }, []);

  // Remember who this browser is (first name + private seat ticket).
  useEffect(() => {
    let raw: string | null;
    try {
      raw = localStorage.getItem(PROFILE_KEY);
    } catch (issue) {
      console.warn('Browser storage is unavailable:', issue);
      notify('Browser storage is unavailable. Keep this tab open to retain your identity.');
      return;
    }
    if (!raw) return;
    try {
      const saved: unknown = JSON.parse(raw);
      if (saved && typeof saved === 'object' && 'token' in saved && typeof saved.token === 'string' &&
        'name' in saved && typeof saved.name === 'string') {
        setProfile({ token: saved.token, name: saved.name });
        setName(saved.name);
        return;
      }
      console.warn('The stored participant profile is invalid and will not be restored.');
    } catch (issue) {
      console.warn('The stored participant profile could not be read:', issue);
    }
    try { localStorage.removeItem(PROFILE_KEY); }
    catch (issue) { console.warn('The stored participant profile could not be removed:', issue); }
  }, [notify]);

  // Show your saved seat, unless the host has erased the class since you picked it.
  const epoch = room?.createdAt;
  useEffect(() => {
    if (!epoch) return;
    const saved = readSavedSeat();
    if (saved && saved.epoch === epoch) {
      setSelected(saved.seat);
    } else {
      setSelected(null);
      if (saved) forgetSavedSeat();
    }
  }, [epoch]);

  // Load the classroom, then check for new seats every couple of seconds.
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      clearTimeout(timer);
      if (stopped || inFlight) return;
      if (document.hidden) {
        timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        return;
      }
      inFlight = true;
      try {
        receiveRoom(await request<Room>('/api/room', undefined, controller.signal));
        failures = 0;
        setConnection('live');
        setLoadError('');
      } catch (issue) {
        if (stopped) return;
        failures += 1;
        setConnection(failures > 1 ? 'offline' : 'connecting');
        setLoadError(errorMessage(issue));
      } finally {
        inFlight = false;
        if (!stopped) {
          const wait = failures ? Math.min(15_000, POLL_INTERVAL_MS * 2 ** failures) : POLL_INTERVAL_MS;
          timer = setTimeout(() => void poll(), wait);
        }
      }
    };
    const wake = () => { if (!document.hidden) void poll(); };
    void poll();
    document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [receiveRoom]);

  const openModal = (next: Modal) => { setError(''); setModal(next); };

  const saveVote = async (seat: number, voter: Profile) => {
    if (!room || voteLock.current) return;
    voteLock.current = true;
    setBusy(true); setError('');
    try {
      const next = await request<Room>('/api/vote', { ...voter, seat });
      let stored = true;
      try {
        const saved: SavedSeat = { epoch: next.createdAt, seat };
        localStorage.setItem(PROFILE_KEY, JSON.stringify(voter));
        localStorage.setItem(SEAT_KEY, JSON.stringify(saved));
      } catch (issue) {
        stored = false;
        console.warn('Could not retain participant identity:', issue);
        notify('Seat saved! Browser storage is unavailable; keep this tab open to avoid voting twice.');
      }
      receiveRoom(next);
      setSelected(seat); setProfile(voter); setModal(null); setPendingSeat(null);
      if (stored) notify(`Seat ${seatLabel(seat)} is yours. ${GROUPS[groupFor(seat)]!.name}, assemble!`);
    } catch (issue) { setError(errorMessage(issue)); }
    finally { setBusy(false); voteLock.current = false; }
  };

  const chooseSeat = (seat: number) => {
    if (busy) return;
    setHovered(null);
    document.body.style.cursor = '';
    if (!room) {
      notify('Hang on, the classroom is still opening.');
    } else if (!profile) {
      setPendingSeat(seat);
      openModal('name');
    } else void saveVote(seat, profile);
  };
  const submitName = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pendingSeat === null) return;
    // crypto.randomUUID is unavailable on non-HTTPS LAN addresses.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    const token = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    void saveVote(pendingSeat, { token, name: name.trim() });
  };
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      notify('Invite link copied. Pass it around!');
    } catch (issue) {
      console.warn('Clipboard permission unavailable:', issue);
      openModal('help');
      setError('Clipboard is unavailable. Copy the invite link below instead.');
    }
  };
  const downloadResults = () => {
    if (!room) return;
    // Aggregate-only export avoids spreadsheet formulas and disclosing guest names.
    const csv = ['Group,Rows,People,Percentage', ...GROUPS.map((g, i) =>
      `${g.name},${i === 0 ? '1-2' : i === 1 ? '3' : '4-5'},${counts[i]},${total ? ((counts[i] ?? 0) / total * 100).toFixed(1) : 0}`)].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `studio91-seating-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Host-only: wipes every registered seat (needs the ADMIN_RESET_KEY passcode).
  const eraseAllSeats = useCallback(async (passcode: string) => {
    const next = await request<Room>('/api/reset', { key: passcode });
    forgetSavedSeat();
    setSelected(null);
    setPendingSeat(null);
    receiveRoom(next);
    notify('All seats erased. The classroom is fresh for your event.');
  }, [notify, receiveRoom]);
  const unavailable = useCallback(() => {
    setView('map');
    notify('3D is unavailable on this device. The interactive seat map is ready instead.');
  }, [notify]);

  const leaders = total ? GROUPS.filter((_, i) => counts[i] === Math.max(...counts)) : [];
  const hoveredPeople = hovered === null ? [] : (room?.votes ?? []).filter((v) => v.seat === hovered);

  return <div className="app-shell" ref={pageRef}>
    <header className="site-header">
      <a className="brand" href={location.pathname} aria-label="Seat picker by Studio +91 home">
        <img className="brand-studio" src={`${import.meta.env.BASE_URL}branding/studio-plus91.webp`}
          alt="studio +91" width={216} height={101} />
        <span className="brand-wordmark">seat picker<span className="brand-period">.</span></span>
      </a>
      <div className="header-middle"><span className="tiny-star">✳</span> A LITTLE NOSTALGIA. A LOT OF US.</div>
      <nav aria-label="Classroom actions">
        <button className="text-button how-button" onClick={() => openModal('help')}><CircleHelp size={15} /> How it works</button>
        <button className="button small invite-button" onClick={() => void copyInvite()}><Share2 size={15} /> Invite classmates</button>
      </nav>
    </header>

    <main>
      <section className="welcome-notes" aria-labelledby="home-title">
        <div className="welcome-copy">
          <h1 className="sr-only" id="home-title">Back to school. Back to your seat.</h1>
          <div className="eyebrow"><span className="eyebrow-line" /> STUDIO +91 HOMECOMING <span className="edition">VOL. 01</span></div>
          <h2>Where did you sit when the bell rang?</h2>
          <p>New faces. Old habits. Find your old spot, and meet your classmates.</p>
        </div>
        <div className="intro-note"><Doodle kind="flower" /><span>No right answers.<br />Just your old spot.</span><Doodle kind="plane" /></div>
      </section>

      <div className="workspace">
        <section className="classroom-card" aria-label="Choose a classroom seat">
          <div className="scene-top">
            <div className="classroom-caption"><span className="caption-dot" /><span>THE MEMORY ROOM<small>20 benches. 40 old spots.</small></span></div>
            <div className="view-tabs" role="tablist" aria-label="Classroom view">
              <button role="tab" aria-selected={view === '3d'} className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}><School size={14} /> 3D classroom</button>
              <button role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><Grid2X2 size={14} /> Seat map</button>
            </div>
          </div>
          <div className={`scene-area ${busy ? 'saving' : ''}`} ref={sceneRef}>
            {view === '3d' ? <Suspense fallback={<div className="scene-loader"><LoaderCircle className="spin" />Opening the classroom...</div>}>
              <Classroom counts={seats} selected={selected} heatmap={heatmap} botSeats={botSeats} seatPoints={seatPoints}
                onSelect={chooseSeat} onHover={setHovered} reset={reset} zoom={zoom} onUnavailable={unavailable} />
            </Suspense> : <SeatMap counts={seats} selected={selected} heatmap={heatmap} botSeats={botSeats} onSelect={chooseSeat} />}
            {hovered !== null && view === '3d' && <div className="seat-tooltip">
              <Armchair size={16} /><b>Seat {seatLabel(hovered)}</b><span>Row {rowFor(hovered) + 1}</span>
              <small>{hoveredPeople.length ? `${hoveredPeople.length} ${hoveredPeople.length === 1 ? 'classmate' : 'classmates'} chose this spot` : 'One shared bench. Your own old spot.'}</small>
            </div>}
            {view === '3d' && <div className="scene-sticker"><span>CLASS OF</span><b>good<br />old days!</b><Sparkles size={15} /></div>}
            <span className="sr-only classroom-markers" aria-live="polite">{total} pencils across the desks. A cat marks each chosen spot; your cat is golden.</span>
            {view === '3d' && <div className="camera-controls">
              <button onClick={() => setZoom((z) => z + 1)} aria-label="Zoom in"><Plus size={16} /></button>
              <button onClick={() => setZoom((z) => z - 1)} aria-label="Zoom out"><Minus size={16} /></button>
              <span />
              <button onClick={() => setReset((r) => r + 1)} aria-label="Reset classroom view"><RotateCcw size={15} /></button>
            </div>}
          </div>
          <div className="scene-bottom">
            <span><MousePointer2 size={14} /> {view === '3d' ? 'Drag to explore' : 'Pick your bench'}<i />Click your side to sit</span>
            <button className={`heatmap-toggle ${heatmap ? 'on' : ''}`} aria-pressed={heatmap} onClick={() => setHeatmap(!heatmap)}>
              <span className="toggle-switch"><i /></span> Seat heatmap
            </button>
          </div>
        </section>

        <aside className="sidebar">
          <section className="seat-card">
            <div className="card-kicker"><span><Armchair size={15} /> TAKE A SEAT</span><span className="step-badge">01</span></div>
            <div className="ticket-icon"><Armchair size={28} strokeWidth={1.5} /><span>✦</span></div>
            <h2>{selected === null ? 'Somewhere in here,\nyou were you.' : `Hey ${profile?.name ?? 'classmate'},\nwelcome back.`}</h2>
            <p>{selected === null ? 'First to raise your hand? Or the unofficial mayor of the back row?' : `Seat ${seatLabel(selected)}. Row ${rowFor(selected) + 1}. A little older, still the same you.`}</p>
            {!room ? (loadError
              ? <p className="inline-error" role="alert">{loadError}</p>
              : <div className="pick-prompt">Opening the classroom... <LoaderCircle className="spin" size={15} /></div>)
              : selected === null ? <div className="pick-prompt"><span className="pulse-ring" />Pick your side of a bench to join <ArrowRight size={15} /></div>
              : <div className="chosen-seat"><span><Check size={16} /> {GROUPS[groupFor(selected)]!.name}</span><small>Change your mind? Click another desk.</small></div>}
            <div className="ticket-tear"><span /><i /><span /></div>
            <div className="seat-footnote"><Users size={13} />Two per bench. Shared seat choices welcome.</div>
            <Doodle kind="hearts" className="ticket-hearts" />
          </section>

          <section className="pulse-card">
            <div className="pulse-heading"><h3>The class so far</h3><span className={`live-badge ${connection}`}><i />{connection === 'live' ? 'LIVE' : connection === 'offline' ? 'RECONNECTING' : connection === 'connecting' ? 'CONNECTING' : 'PREVIEW'}</span></div>
            <div className="attendance"><b>{String(total).padStart(2, '0')}</b><span>familiar souls<br />{total === 1 ? 'has' : 'have'} found a seat</span><Users size={26} strokeWidth={1.3} /></div>
            <ResultsChart votes={room?.votes ?? emptyVotes} />
            <button className="results-link" disabled={!total} onClick={() => openModal('results')}>Discover our seating story <ArrowRight size={16} /></button>
          </section>
          {connection === 'offline' && room && <p role="status" className="connection-warning">Connection lost. Reconnecting automatically; results may be out of date.</p>}
          {error && !modal && <p className="inline-error" role="alert">{error}</p>}
        </aside>
      </div>

      <section className="row-stories" aria-label="Every row has a personality">
        <div className="row-stories-intro"><span className="eyebrow">EVERY ROW HAS A STORY</span><h2>Which one was yours?</h2></div>
        {GROUPS.map((group, i) => <div className={`row-story story-${i}`} key={group.name}>
          <span className="story-number">0{i + 1}</span><div><h3>{group.name}</h3><p>{group.note}</p></div>
          {i === 0 ? <BookOpen size={25} strokeWidth={1.3} /> : i === 1 ? <Armchair size={25} strokeWidth={1.3} /> : <Sparkles size={25} strokeWidth={1.3} />}
        </div>)}
      </section>
      <div className="bottom-note"><Doodle kind="sun" /><div><span>PSST... THE DESK IS JUST THE BEGINNING.</span><p>Turns out, we might have more in common than we think.</p></div><Doodle kind="plane" /></div>
    </main>
    <footer>
      <span><MicrosoftMark /> A little play, by <b>Studio +91</b></span>
      <span>Made for connection. Not for report cards. <span className="footer-spark">✳</span></span>
      <HostTools onErase={eraseAllSeats} />
    </footer>

    {modal && <ModalShell title={modal === 'name' ? 'First, a little introduction.' : modal === 'results' ? 'So, where did we all sit?' : 'A trip down memory lane.'}
      wide={modal === 'results'} onClose={() => { if (!busy) { setModal(null); setError(''); } }}>
      {modal === 'name' && <form onSubmit={submitName}>
        <div className="name-seat-preview"><Armchair size={28} /><span>Seat {pendingSeat === null ? '' : seatLabel(pendingSeat)}<small>Your new-old spot.</small></span></div>
        <label htmlFor="guest-name">What should we call you?</label>
        <input id="guest-name" autoFocus autoComplete="given-name" maxLength={32} required placeholder="First name or nickname" value={name} onChange={(event) => setName(event.target.value)} />
        <p className="privacy-note">Your name and seat choice are visible to everyone with the link. No email, no account, no report card.</p>
        <button className="button full" disabled={busy || !name.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Armchair size={17} />} That's my seat</button>
      </form>}
      {modal === 'results' && <>
        <div className="results-headline"><span className="results-total">{total}</span><div><b>different people.<br />A few familiar patterns.</b><p>Updating live</p></div><Sparkles size={36} strokeWidth={1.2} /></div>
        <div className="winning-note">{leaders.length === 1 ? <><b>{leaders[0]?.name}</b> are running this classroom.</> : <>It's a tie between <b>{leaders.map((g) => g.name).join(' & ')}</b>.</>}</div>
        <ResultsChart votes={room?.votes ?? emptyVotes} large />
        <div className="result-heatmap"><h3>A little map of us</h3><div className="mini-grid">
          {Array.from({ length: ROWS }, (_, row) => <div className="mini-row" key={row}>
            {Array.from({ length: BENCHES_PER_ROW }, (_, bench) => <div className="mini-bench" key={bench}>
              {Array.from({ length: SEATS_PER_BENCH }, (_, side) => {
                const seat = row * COLUMNS + bench * SEATS_PER_BENCH + side;
                const count = seats[seat] ?? 0;
                return <span key={seat} style={{ opacity: count ? 0.3 + count / Math.max(...seats) * 0.7 : 1, background: count ? GROUPS[groupFor(seat)]!.color : '#e3e5ee' }}
                  title={`Seat ${seatLabel(seat)}: ${count} ${count === 1 ? 'person' : 'people'}`}>{count || ''}</span>;
              })}
            </div>)}
          </div>)}
        </div><small>Front of class ↑ · Two spots per bench · Darker means more classmates</small></div>
        <div className="modal-actions"><span>{new Set((room?.votes ?? []).map((v) => v.seat)).size} of 40 seats chosen</span><button className="button small" onClick={downloadResults}><Download size={15} /> Save results</button></div>
      </>}
      {modal === 'help' && <>
        <p>A tiny classroom for a big reunion. Here's how to play.</p>
        <ol className="how-steps"><li><span>1</span><div><b>Open the link.</b><p>Everyone lands in the same classroom. No codes, no sign-ups.</p></div></li><li><span>2</span><div><b>Find your old spot.</b><p>Choose your side of a bench and enter a first name. A golden cat marks your spot. Everyone adds one big pencil to their desk; shared choices build a pencil mountain. Moving seats moves your pencil, too.</p></div></li><li><span>3</span><div><b>See what connects you.</b><p>Reveal the seating story: front rows 1-2, middle row 3, back rows 4-5. Backbench scribbles included. Everyone is welcome, even if all 200 choose the same desk!</p></div></li></ol>
        <p className="privacy-note">Psst... Gabbar, Piku and friends are only visiting. Only real classmates are counted.</p>
        <div className="share-box"><label htmlFor="invite-link"><Link size={14} /> Your classroom invite</label><input id="invite-link" readOnly value={inviteLink} onFocus={(event) => event.target.select()} /></div>
        <p className="privacy-note">Names and choices are visible to everyone with the link and saved on the server. One seat per browser, not verified per person. Keep the link within your group.</p>
      </>}
      {error && <p role="alert" className="inline-error">{error}</p>}
    </ModalShell>}
    <SimulatedClassmates view={view} pageRef={pageRef} sceneRef={sceneRef} seatPoints={seatPoints} onTrySeats={setBotSeats} />
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
    <span className="sr-only" aria-live="polite">{busy ? 'Saving, please wait.' : ''}</span>
  </div>;
}
