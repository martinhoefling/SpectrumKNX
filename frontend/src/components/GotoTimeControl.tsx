import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';

// "Quick goto time" control for the telegram list (#282): a clock button that
// opens a small time-entry popover. Submitting jumps the list to the telegram
// nearest that time and (via the parent) stops live-following.

interface GotoTimeControlProps {
  /** Newest telegram time (epoch ms) used to seed the input, or null when empty. */
  seedMs: number | null;
  /** Called with the chosen time (epoch ms) when the user submits. */
  onGoto: (targetMs: number) => void;
}

/** date-fns pattern for an <input type="datetime-local" step="1"> value (local time). */
const INPUT_FMT = "yyyy-MM-dd'T'HH:mm:ss";

export const GotoTimeControl: React.FC<GotoTimeControlProps> = ({ seedMs, onGoto }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    // Reseed to the newest telegram each time the popover opens.
    setValue(seedMs != null ? format(new Date(seedMs), INPUT_FMT) : '');
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
    setOpen(true);
  };

  // Close on Escape or an outside click, mirroring SendToGaPopover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!cardRef.current?.contains(n) && !btnRef.current?.contains(n)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const submit = () => {
    const ms = new Date(value).getTime();
    if (!Number.isNaN(ms)) onGoto(ms);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        className={`quick-filter-bar-toggle ${open ? 'open' : ''}`}
        onClick={toggle}
        title="Go to time"
        aria-label="Go to time"
      >
        <Clock size={13} />
      </button>
      {open && pos && createPortal(
        <div
          ref={cardRef}
          className="goto-time-popover"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000 }}
        >
          <input
            type="datetime-local"
            step="1"
            className="goto-time-input"
            value={value}
            autoFocus
            aria-label="Target time"
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
          <button className="goto-time-go" onClick={submit} disabled={!value}>Go</button>
        </div>,
        document.body,
      )}
    </>
  );
};
