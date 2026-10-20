import { Fragment, useEffect, useRef, useState } from 'react';
import { SHORTCUTS, isMod, isTyping } from './shortcuts';

/** Mouse actions read better as plain text than as key caps. */
const isGesture = (k: string) => /\s|^(Click|Drag|Scroll|Right-drag)$/.test(k);

/** "?" button in the top bar and the keyboard shortcuts overlay it opens (also on "?"). */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (e.key === '?' && !isMod(e) && !e.altKey && !isTyping(e.target)) {
        setOpen((o) => !o);
        e.preventDefault();
      }
    };
    // Capture, so Escape closes the overlay before it clears the bin selection.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  return (
    <>
      <button className="icon-button help-button" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setOpen(true)}>
        ?
      </button>
      {open && (
        <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="overlay-card shortcuts" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
            <header>
              <h2 id="shortcuts-title">Keyboard shortcuts</h2>
              <button ref={closeRef} className="icon-button" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            <div className="shortcut-groups">
              {SHORTCUTS.map((g) => (
                <section key={g.title}>
                  <h3>{g.title}</h3>
                  <dl>
                    {g.items.map((it) => (
                      <Fragment key={it.label}>
                        <dt>
                          {it.keys.map((chord, i) => (
                            <Fragment key={i}>
                              {i > 0 && <span className="or">or</span>}
                              {chord.map((k, j) => (
                                <Fragment key={j}>
                                  {j > 0 && <span className="plus">+</span>}
                                  {isGesture(k) ? <span className="gesture">{k}</span> : <kbd>{k}</kbd>}
                                </Fragment>
                              ))}
                            </Fragment>
                          ))}
                        </dt>
                        <dd>{it.label}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
