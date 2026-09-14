import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ExpandableMapProps {
  height: string;
  children: (controls: { expanded: boolean; toggleExpanded: () => void }) => React.ReactNode;
}

export function ExpandableMap({ height, children }: ExpandableMapProps) {
  const [expanded, setExpanded] = useState(false);
  const [content] = useState(() => {
    const element = document.createElement('div');
    element.className = 'relative flex h-full w-full min-h-0 flex-col overflow-hidden bg-slate-900';
    return element;
  });
  const inlineRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (expanded) openerRef.current = focus;
    // A stable portal preserves Leaflet's map, zoom and live subscription while
    // moving it to the browser's top layer (also works inside animated modals).
    (expanded ? dialog : inlineRef.current!).appendChild(content);
    if (expanded) dialog.showModal();
    else if (dialog.open) dialog.close();
    const focusTarget = expanded ? focus : openerRef.current;
    if (focusTarget && content.contains(focusTarget)) focusTarget.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    if (expanded) document.body.style.overflow = 'hidden';
    return () => {
      if (expanded) {
        dialog.close();
        document.body.style.overflow = previousOverflow;
      }
    };
  }, [content, expanded]);

  return <>
    <div ref={inlineRef} className={`relative w-full ${height} overflow-hidden rounded-2xl border border-slate-700 shadow-inner`} />
    {createPortal(
      <dialog ref={dialogRef} aria-label="Карта рейса на весь экран"
        onCancel={event => { event.preventDefault(); setExpanded(false); }}
        onClose={() => { if (!dialogRef.current?.open) setExpanded(false); }}
        style={{ position: 'fixed', inset: 0, margin: 0, padding: 0, border: 0,
          width: '100%', height: '100dvh', maxWidth: 'none', maxHeight: 'none', background: '#0f172a' }}>
      </dialog>, document.body)}
    {createPortal(children({ expanded, toggleExpanded: () => setExpanded(value => !value) }), content)}
  </>;
}
