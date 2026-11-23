import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';

// A quiet "···" menu in the footer for the host. Erasing needs the passcode
// saved as ADMIN_RESET_KEY in Vercel, so guests can't wipe the classroom.
export default function HostTools({ onErase }: { onErase: (passcode: string) => Promise<void> }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const erase = async (event: FormEvent) => {
    event.preventDefault();
    const key = passcode.trim();
    if (!key || busy) return;
    if (!window.confirm('Erase every seat for everyone? Use this before your event starts. It cannot be undone.')) return;
    setBusy(true);
    setMessage('');
    try {
      await onErase(key);
      setPasscode('');
      if (menu.current) menu.current.open = false;
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : 'The seats could not be erased. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return <details className="host-tools" ref={menu}>
    <summary aria-label="Host tools" title="Host tools">···</summary>
    <form onSubmit={(event) => void erase(event)}>
      <b>Host tools</b>
      <label htmlFor="host-passcode">Passcode</label>
      <input id="host-passcode" type="password" autoComplete="off" value={passcode}
        onChange={(event) => setPasscode(event.target.value)} />
      <button className="button small danger" disabled={busy || !passcode.trim()}>
        {busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />} Erase all seats
      </button>
      {message && <p role="alert">{message}</p>}
      <small>Clears every registered seat for everyone. The famous visitors stay.</small>
    </form>
  </details>;
}
