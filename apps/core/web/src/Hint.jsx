import React, {useId, useState} from 'react';

// Accessible "?" tip: visible on hover and keyboard focus, announced to assistive tech.
export default function Hint({term, meaning, className = ''}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-flex items-baseline ${className}`}>
      <button
        type="button"
        className="ml-0.5 inline-flex items-center justify-center w-4 h-4 text-[10px] font-semibold leading-none rounded-full border border-current/40 text-current/80 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-describedby={id}
        aria-expanded={open}
        aria-label={`${term} means ${meaning}`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={e => { e.preventDefault(); setOpen(o => !o); }}
      >?</button>
      <span
        id={id}
        role="tooltip"
        className={`absolute z-30 left-1/2 -translate-x-1/2 bottom-[calc(100%+0.4rem)] w-56 rounded-lg bg-slate-900 text-white text-xs font-normal leading-snug px-3 py-2 shadow-lg ${open ? 'block' : 'hidden'}`}
      >
        <span className="sr-only">{term} means </span>{meaning}
      </span>
    </span>
  );
}
