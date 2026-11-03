import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SELECT_LIST_ATTRIBUTE } from './Select';

const VIEWPORT_MARGIN = 8;

/** 浮かせる要素の基準。右側に置き、入らなければ左側に置く。 */
export interface Anchor {
  left: number;
  right: number;
  top: number;
}

export const pointAnchor = (x: number, y: number): Anchor => ({ left: x, right: x, top: y });

export function Floating({ anchor, className, onClose, label, role, children }: {
  anchor: Anchor;
  className: string;
  onClose: () => void;
  label: string;
  role: string;
  children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; origin: string } | null>(null);

  useLayoutEffect(() => {
    const { width, height } = element.current!.getBoundingClientRect();
    const fits = anchor.right + width + VIEWPORT_MARGIN <= window.innerWidth;
    const left = Math.max(VIEWPORT_MARGIN, fits ? anchor.right : anchor.left - width);
    const top = Math.max(VIEWPORT_MARGIN, Math.min(anchor.top, window.innerHeight - height - VIEWPORT_MARGIN));
    setPosition({ left, top, origin: `${fits ? 'left' : 'right'} top` });
  }, [anchor]);

  // 配置が決まるまでは非表示で、フォーカスできない。
  useEffect(() => {
    if (position) element.current!.focus();
  }, [position]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!element.current?.contains(target) && !target.closest(`[${SELECT_LIST_ATTRIBUTE}]`)) onClose();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div ref={element} className={className} role={role} aria-label={label} tabIndex={-1}
      style={{
        left: position?.left,
        top: position?.top,
        transformOrigin: position?.origin,
        visibility: position ? 'visible' : 'hidden',
      }}
      onContextMenu={(event) => event.preventDefault()}>
      {children}
    </div>
  );
}

export type MenuEntry =
  | { label: string; onSelect?: () => void; danger?: boolean; disabled?: boolean; submenu?: MenuEntry[] }
  | { content: ReactNode }
  | 'separator';

function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(':scope > div > [role="menuitem"]:not(:disabled)')];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  items[(index + step + items.length) % items.length]?.focus();
  event.preventDefault();
  event.stopPropagation();
}

/** 右に入らなければ左に開く。 */
function Submenu({ label, entries, onClose }: { label: string; entries: MenuEntry[]; onClose: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);
  useLayoutEffect(() => {
    setFlipped(element.current!.getBoundingClientRect().right + VIEWPORT_MARGIN > window.innerWidth);
  }, []);
  return (
    <div ref={element} className={flipped ? 'context-menu submenu flipped' : 'context-menu submenu'} role="menu" aria-label={label}>
      <MenuItems entries={entries} onClose={onClose} />
    </div>
  );
}

function MenuItems({ entries, onClose, autoFocus }: { entries: MenuEntry[]; onClose: () => void; autoFocus?: boolean }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const element = useRef<HTMLDivElement>(null);

  // メニュー自体にフォーカスがあるときも、矢印キーで項目へ移動できるようにする。
  useEffect(() => {
    if (!autoFocus) return;
    const menu = element.current!.parentElement!;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (document.activeElement !== menu || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
      event.preventDefault();
      element.current!.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    };
    menu.addEventListener('keydown', onKeyDown);
    return () => menu.removeEventListener('keydown', onKeyDown);
  }, [autoFocus]);

  return (
    <div ref={element} className="menu-items" onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') moveFocus(event);
    }}>
      {entries.map((entry, index) => {
        if (entry === 'separator') return <div key={index} className="menu-separator" role="separator" />;
        if ('content' in entry) return <div key={index} className="menu-content">{entry.content}</div>;
        const { label, onSelect, danger, disabled, submenu } = entry;
        const open = openIndex === index;
        return (
          <div key={index} className="menu-row" onPointerEnter={() => setOpenIndex(submenu ? index : null)}>
            <button role="menuitem" className={danger ? 'menu-item danger' : 'menu-item'} disabled={disabled}
              aria-haspopup={submenu ? 'menu' : undefined} aria-expanded={submenu ? open : undefined}
              onKeyDown={(event) => {
                if (submenu && event.key === 'ArrowRight') setOpenIndex(index);
                if (event.key === 'ArrowLeft') setOpenIndex(null);
              }}
              onClick={() => {
                if (submenu) {
                  setOpenIndex(index);
                  return;
                }
                onSelect?.();
                onClose();
              }}>
              <span>{label}</span>
              {submenu && <span className="menu-arrow" aria-hidden="true">›</span>}
            </button>
            {submenu && open && !disabled && <Submenu label={label} entries={submenu} onClose={onClose} />}
          </div>
        );
      })}
    </div>
  );
}

export function ContextMenu({ anchor, label, entries, onClose }: {
  anchor: Anchor;
  label: string;
  entries: MenuEntry[];
  onClose: () => void;
}) {
  return (
    <Floating anchor={anchor} className="context-menu floating" role="menu" label={label} onClose={onClose}>
      <MenuItems entries={entries} onClose={onClose} autoFocus />
    </Floating>
  );
}
