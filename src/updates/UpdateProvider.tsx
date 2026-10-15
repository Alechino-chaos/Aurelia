import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpCircle, LoaderCircle } from 'lucide-react';
import type { UpdateState } from '../types';
import { useLanguage } from '../i18n/LanguageProvider';
import { updateMessages } from './messages';
import './updates.css';

export type UpdateAction = 'check' | 'download' | 'cancel' | 'install' | 'preference' | 'release' | 'connect';
type TransportFailure = { action: UpdateAction; preference?: boolean };
type Updates = { state: UpdateState | null; pending: UpdateAction[]; failure: TransportFailure | null;
  act: (action: UpdateAction, preference?: boolean) => Promise<void>; later: () => void; open: () => void;
  registerOpener: (opener: () => void) => () => void; setPanelOpen: (value: boolean) => void; preferenceAttempt: boolean | undefined };
const Context = createContext<Updates | null>(null);
export function UpdateProvider({ children }: { children: ReactNode }) {
  const { locale } = useLanguage(), { text } = updateMessages(locale);
  const [state, setState] = useState<UpdateState | null>(null), [pending, setPending] = useState<UpdateAction[]>([]);
  const [failure, setFailure] = useState<TransportFailure | null>(null), [panelOpen, setPanelOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [preferenceAttempt, setPreferenceAttempt] = useState<boolean>();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const inFlight = useRef(new Set<UpdateAction>()), opener = useRef<(() => void) | null>(null), alive = useRef(false), revision = useRef(0);
  const savingDialog = useRef<HTMLDivElement>(null), restoreFocus = useRef<HTMLElement | null>(null);
  const rememberFocus = () => { restoreFocus.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  const receive = useCallback((next: UpdateState) => {
    revision.current++;
    if (alive.current) { if (next.phase === 'preparing') rememberFocus(); setState(next); }
  }, []);
  const act = useCallback(async (action: UpdateAction, preference?: boolean) => {
    if (inFlight.current.has(action)) return;
    if (action === 'install') rememberFocus();
    inFlight.current.add(action); setPending([...inFlight.current]); setFailure(null);
    if (action === 'preference') setPreferenceAttempt(preference);
    const before = revision.current;
    try {
      const bridge = window.paperdesk;
      if (!bridge) throw new Error('Unavailable');
      let next: UpdateState | undefined;
      switch (action) {
        case 'connect': next = await bridge.getUpdateState(); await bridge.updaterReady(); break;
        case 'check': next = await bridge.checkForUpdates(); break;
        case 'download': next = await bridge.downloadUpdate(); break;
        case 'cancel': next = await bridge.cancelUpdateDownload(); break;
        case 'install': next = await bridge.installUpdate(); break;
        case 'preference': next = await bridge.setAutoCheckUpdates(preference!); break;
        case 'release': await bridge.openUpdateReleasePage(); break;
      }
      // Notifications can be newer than an outstanding IPC response, especially
      // after cancel. Never roll an authoritative notification back.
      if (next && revision.current === before) receive(next);
    } catch { if (alive.current) setFailure({ action, preference }); }
    finally { inFlight.current.delete(action); if (alive.current) setPending([...inFlight.current]); }
  }, [receive]);
  useEffect(() => {
    alive.current = true;
    const bridge = window.paperdesk;
    let unsubscribe: (() => void) | undefined;
    try { unsubscribe = bridge?.onUpdateState(receive); }
    catch { setFailure({ action: 'connect' }); }
    void act('connect');
    return () => { alive.current = false; unsubscribe?.(); };
  }, [act, receive]);
  useEffect(() => {
    const bridge = window.paperdesk;
    if (!bridge) return;
    let active = true, received = false;
    const off = bridge.onClosingState(value => { received = true; if (active) setClosing(value); });
    void bridge.getClosingState().then(value => { if (active && !received) setClosing(value); }).catch(() => {});
    return () => { active = false; off(); };
  }, []);
  const locked = closing || state?.phase === 'preparing' || pending.includes('install');
  useLayoutEffect(() => {
    if (!locked) return;
    rememberFocus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusSaving = () => savingDialog.current?.focus({ preventScroll: true });
    // Inert blocks pointer/focus editing; capture also blocks the reader's
    // window shortcuts and Escape before Settings or draft handlers run.
    const guardKeyboard = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); focusSaving(); };
    const guardFocus = (event: FocusEvent) => { if (!savingDialog.current?.contains(event.target as Node)) focusSaving(); };
    document.addEventListener('keydown', guardKeyboard, true);
    document.addEventListener('focusin', guardFocus, true);
    focusSaving();
    return () => {
      document.removeEventListener('keydown', guardKeyboard, true);
      document.removeEventListener('focusin', guardFocus, true);
      document.body.style.overflow = previousOverflow;
      const previous = restoreFocus.current; restoreFocus.current = null;
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('.settings-dialog [role="tab"][aria-selected="true"], .update-app-surface button:not(:disabled)')?.focus({ preventScroll: true });
    };
  }, [locked]);
  const registerOpener = useCallback((value: () => void) => { opener.current = value; return () => { if (opener.current === value) opener.current = null; }; }, []);
  const open = useCallback(() => opener.current?.(), []);
  const offerKey = state?.availableVersion && ['available', 'downloaded'].includes(state.phase) ? `${state.availableVersion}:${state.phase}` : null;
  const later = () => { if (offerKey) setDismissed(old => new Set([...old, offerKey])); };
  const value: Updates = { state, pending, failure, act, later, open, registerOpener, setPanelOpen, preferenceAttempt };
  return <Context.Provider value={value}><div className="update-app-surface" inert={locked}>{children}</div>
    {locked && <div className="update-saving-backdrop" onMouseDown={event => { event.preventDefault(); savingDialog.current?.focus({ preventScroll: true }); }}><div className="update-saving-dialog" ref={savingDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="update-saving-title" aria-describedby="update-saving-detail" data-testid="update-saving-overlay">
      <LoaderCircle size={24} className="spin" aria-hidden="true" /><h2 id="update-saving-title">{text(closing ? 'closingTitle' : 'savingTitle')}</h2><p id="update-saving-detail" role="status">{text(closing ? 'closingHelp' : 'savingHelp')}</p>
    </div></div>}
    {!locked && offerKey && !dismissed.has(offerKey) && !panelOpen && <aside className="update-toast" data-testid="update-toast" aria-label={text('about')}>
      <div className="update-toast-message" role="status"><ArrowUpCircle size={21} aria-hidden="true" /><span><strong>{state?.phase === 'downloaded' ? text('ready') : text('newVersion')}</strong><span>Aurelia {state?.availableVersion}</span></span></div>
      <div className="update-toast-actions"><button type="button" onClick={open}>{text('view')}</button><button type="button" onClick={later}>{text('later')}</button></div>
    </aside>}
  </Context.Provider>;
}
export function useUpdates() { const context = useContext(Context); if (!context) throw new Error('UpdateProvider is required'); return context; }
