import React from 'react';
import { Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTrackingText } from './useTrackingText';

export type CellMove = 'next' | 'prev';

interface EditableCellProps {
  value: string;
  type?: 'text' | 'date';
  editing: boolean;
  disabled?: boolean;
  placeholder?: string;
  display?: React.ReactNode;
  className?: string;
  inputClassName?: string;
  label: string;
  onStart: () => void;
  onCommit: (value: string, move?: CellMove) => void;
  onCancel: () => void;
}

type CellInputProps = Pick<EditableCellProps, 'value' | 'type' | 'label' | 'inputClassName' | 'onCommit' | 'onCancel'>;

// Mounted fresh for every edit, so the draft always starts from the saved value.
const CellInput = ({ value, type = 'text', label, inputClassName, onCommit, onCancel }: CellInputProps) => {
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const finished = React.useRef(false);

  React.useEffect(() => {
    inputRef.current?.focus();
    if (type === 'text') inputRef.current?.select();
  }, [type]);

  const finish = (move?: CellMove) => {
    if (finished.current) return;
    finished.current = true;
    onCommit(type === 'text' ? draft.trim() : draft, move);
  };

  return (
    <input
      ref={inputRef}
      type={type}
      value={draft}
      aria-label={label}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => finish()}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); finish(); }
        else if (event.key === 'Tab') { event.preventDefault(); finish(event.shiftKey ? 'prev' : 'next'); }
        else if (event.key === 'Escape') { event.preventDefault(); finished.current = true; onCancel(); }
      }}
      className={cn(
        'w-full rounded-md border border-blue-400 bg-white px-2 py-1 text-sm text-slate-900 shadow-[0_0_0_3px_rgba(59,130,246,0.15)] outline-none',
        inputClassName,
      )}
    />
  );
};

// Click (or Enter / F2) to edit. Enter or leaving the cell saves, Tab saves and jumps to the
// next cell like in Excel, Esc cancels.
export const EditableCell = ({
  value, type = 'text', editing, disabled, placeholder = '—', display, className, inputClassName, label, onStart, onCommit, onCancel,
}: EditableCellProps) => {
  const { text } = useTrackingText();
  if (editing) {
    return <CellInput value={value} type={type} label={label} inputClassName={inputClassName} onCommit={onCommit} onCancel={onCancel} />;
  }

  return (
    <div
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? -1 : 0}
      title={disabled ? undefined : text.editCellTitle(label)}
      onClick={() => !disabled && onStart()}
      onKeyDown={event => {
        if (!disabled && (event.key === 'Enter' || event.key === 'F2')) { event.preventDefault(); onStart(); }
      }}
      className={cn(
        'group/cell relative flex min-h-[30px] w-full items-center gap-1 rounded-md px-2 py-1 text-start text-sm',
        !disabled && 'cursor-text hover:bg-blue-50/70 hover:ring-1 hover:ring-blue-200 focus-visible:bg-blue-50',
        className,
      )}
    >
      <span className={cn('min-w-0 flex-1', !value && 'text-slate-400')}>{value ? (display ?? value) : placeholder}</span>
      {!disabled && <Pencil className="h-3 w-3 shrink-0 text-slate-300 opacity-0 transition-opacity group-hover/cell:opacity-100" />}
    </div>
  );
};
