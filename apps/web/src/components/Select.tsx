import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

const LIST_GAP = 4;
const LIST_MAX_HEIGHT = 280;
const VIEWPORT_MARGIN = 8;

/** 開いている一覧。外側のクリックで閉じる要素が、一覧を内側として扱うための印。 */
export const SELECT_LIST_ATTRIBUTE = 'data-select-list';

export interface SelectOption {
  value: string;
  label: string;
}

/** ブラウザ標準の一覧は配色を変えられないので、ダークテーマに合わせた一覧を表示する。 */
export function Select({ value, options, placeholder, label, disabled, className, onChange }: {
  value: string;
  options: SelectOption[];
  /** 選択中の項目がないときの表示。 */
  placeholder?: string;
  /** 読み上げのラベル。 */
  label?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  const show = () => {
    if (disabled || options.length === 0) return;
    setHighlight(Math.max(selectedIndex, 0));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setPosition(null);
  };
  const choose = (option: SelectOption) => {
    close();
    if (option.value !== value) onChange(option.value);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const { left, top, bottom, width } = trigger.current!.getBoundingClientRect();
    const height = Math.min(list.current!.scrollHeight, LIST_MAX_HEIGHT);
    const fitsBelow = bottom + LIST_GAP + height + VIEWPORT_MARGIN <= window.innerHeight;
    setPosition(fitsBelow
      ? { left, width, top: bottom + LIST_GAP }
      : { left, width, bottom: window.innerHeight - top + LIST_GAP });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.children[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, position]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    const onScroll = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        show();
      }
      return;
    }
    if (event.key === 'Tab') close();
    if (event.key === 'ArrowDown') setHighlight((highlight + 1) % options.length);
    if (event.key === 'ArrowUp') setHighlight((highlight - 1 + options.length) % options.length);
    if (event.key === 'Enter' || event.key === ' ') choose(options[highlight]!);
    if (event.key === 'Escape') close();
    if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape'].includes(event.key)) {
      event.preventDefault();
      // 開いているダイアログやメニューまで閉じないようにする。
      event.stopPropagation();
    }
  };

  return (
    <>
      <button ref={trigger} type="button" className={className ? `select ${className}` : 'select'} disabled={disabled}
        role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? listId : undefined} aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
        onClick={() => (open ? close() : show())} onKeyDown={onKeyDown}>
        <span className={selected ? 'select-value' : 'select-value placeholder'}>{selected?.label ?? placeholder}</span>
        <svg className={open ? 'select-chevron open' : 'select-chevron'} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>
      {open && createPortal(
        <div ref={list} id={listId} className="select-list" role="listbox" aria-label={label} {...{ [SELECT_LIST_ATTRIBUTE]: '' }}
          style={position ? { ...position, maxHeight: LIST_MAX_HEIGHT } : { visibility: 'hidden' }}
          onPointerDown={(event) => event.preventDefault()}>
          {options.map((option, index) => (
            <div key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value}
              className={index === highlight ? 'select-option active' : 'select-option'}
              onPointerEnter={() => setHighlight(index)} onClick={() => choose(option)}>
              <span>{option.label}</span>
              {option.value === value && <span aria-hidden="true">✓</span>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
