import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, Check, X } from 'lucide-react';

const DialogContext = createContext(null);

const TYPES = {
  danger:  { Icon: AlertTriangle, iconColor: 'text-red-500',    bg: 'bg-red-100 dark:bg-red-900/20',    btn: 'bg-red-500 hover:bg-red-600 text-white' },
  warning: { Icon: Info,          iconColor: 'text-yellow-500', bg: 'bg-yellow-100 dark:bg-yellow-900/20', btn: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
  info:    { Icon: Info,          iconColor: 'text-blue-500',   bg: 'bg-blue-100 dark:bg-blue-900/20',   btn: 'bg-blue-500 hover:bg-blue-600 text-white' },
  success: { Icon: Check,         iconColor: 'text-green-500',  bg: 'bg-green-100 dark:bg-green-900/20', btn: 'bg-green-500 hover:bg-green-600 text-white' },
};

export const DialogProvider = ({ children }) => {
  const [confirmState, setConfirmState] = useState(null);
  const [promptState, setPromptState] = useState(null);
  const confirmResolverRef = useRef(null);
  const promptResolverRef = useRef(null);

  const confirm = useCallback((opts = {}) => new Promise((resolve) => {
    confirmResolverRef.current = resolve;
    setConfirmState({
      title: opts.title || 'Confirmar ação',
      message: opts.message || 'Tem certeza?',
      confirmText: opts.confirmText || 'Confirmar',
      cancelText: opts.cancelText || 'Cancelar',
      type: opts.type || 'danger',
    });
  }), []);

  const prompt = useCallback((opts = {}) => new Promise((resolve) => {
    promptResolverRef.current = resolve;
    setPromptState({
      title: opts.title || 'Digite o valor',
      message: opts.message || '',
      placeholder: opts.placeholder || '',
      defaultValue: opts.defaultValue || '',
      confirmText: opts.confirmText || 'Confirmar',
      cancelText: opts.cancelText || 'Cancelar',
      type: opts.type || 'info',
      required: opts.required !== false,
    });
  }), []);

  const closeConfirm = (result) => {
    if (confirmResolverRef.current) confirmResolverRef.current(result);
    confirmResolverRef.current = null;
    setConfirmState(null);
  };

  const closePrompt = (result) => {
    if (promptResolverRef.current) promptResolverRef.current(result);
    promptResolverRef.current = null;
    setPromptState(null);
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {confirmState && <ConfirmDialog {...confirmState} onClose={closeConfirm} />}
      {promptState && <PromptDialog {...promptState} onClose={closePrompt} />}
    </DialogContext.Provider>
  );
};

const ConfirmDialog = ({ title, message, confirmText, cancelText, type, onClose }) => {
  const variant = TYPES[type] || TYPES.danger;
  const { Icon, iconColor, bg, btn } = variant;

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose(false);
      if (e.key === 'Enter') onClose(true);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="ui-overlay-fade fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => onClose(false)}
    >
      <div
        className="ui-modal-surface bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={`p-2 rounded-full ${bg}`}>
              <Icon className={`w-6 h-6 ${iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1.5">{title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">{message}</p>
            </div>
          </div>
          <div className="flex gap-3 justify-end mt-6">
            <button
              onClick={() => onClose(false)}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              {cancelText}
            </button>
            <button
              onClick={() => onClose(true)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${btn}`}
              autoFocus
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const PromptDialog = ({ title, message, placeholder, defaultValue, confirmText, cancelText, type, required, onClose }) => {
  const [value, setValue] = useState(defaultValue || '');
  const variant = TYPES[type] || TYPES.info;
  const { Icon, iconColor, bg, btn } = variant;
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = String(value || '').trim();
    if (required && !trimmed) return;
    onClose(trimmed);
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') onClose(null);
    if (e.key === 'Enter') submit();
  };

  return (
    <div
      className="ui-overlay-fade fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => onClose(null)}
    >
      <div
        className="ui-modal-surface bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className={`p-2 rounded-full ${bg}`}>
              <Icon className={`w-6 h-6 ${iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1.5">{title}</h3>
              {message ? <p className="text-sm text-gray-600 dark:text-gray-300">{message}</p> : null}
            </div>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
          />
          <div className="flex gap-3 justify-end mt-6">
            <button
              onClick={() => onClose(null)}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              {cancelText}
            </button>
            <button
              onClick={submit}
              disabled={required && !String(value || '').trim()}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${btn}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const useDialog = () => {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog deve ser usado dentro de DialogProvider');
  return ctx;
};
