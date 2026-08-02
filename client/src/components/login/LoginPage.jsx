import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, LogIn, User } from 'lucide-react';
import ClickSpark from './ClickSpark';
import NetworkGlobe from './NetworkGlobe';
import OnionLoader from './OnionLoader';
import OnionMark from './OnionMark';
import SpecularButton from './SpecularButton';
import './LoginPage.css';

const APPEARANCES = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' }
];

const formatUptime = total => {
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

export default function LoginPage({
  onSubmit,
  onSuccess,
  brandName = 'Onion Flows',
  title = 'Acesse sua conta',
  subtitle = 'Use suas credenciais da equipe Onion Flows.',
  build = 'reusable-kit-1.0',
  region = 'Goioerê',
  transitionDuration = 3600
}) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [appearance, setAppearance] = useState(() => localStorage.getItem('appearancePreference') || 'system');
  const [uptime, setUptime] = useState(() => Math.floor(performance.now() / 1000));
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setUptime(Math.floor(performance.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = appearance === 'dark' || (appearance === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem('appearancePreference', appearance);
    };
    apply();
    if (appearance === 'system') media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);

  const submit = async event => {
    event.preventDefault();
    if (!form.username || !form.password || loading) return;
    setError('');
    setLoading(true);
    try {
      const result = await onSubmit?.({ username: form.username.trim(), password: form.password });
      setTransitioning(true);
      await new Promise(resolve => window.setTimeout(resolve, transitionDuration));
      onSuccess?.(result);
    } catch (reason) {
      setError(reason?.message || 'Não foi possível entrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (transitioning) {
    return (
      <main className="onion-login-page relative grid min-h-screen place-items-center overflow-hidden bg-white dark:bg-slate-950" aria-live="polite">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.09),transparent_36%)] dark:bg-[radial-gradient(circle_at_center,rgba(96,165,250,0.12),transparent_36%)]" />
        <OnionLoader size={108} label="Preparando seu espaço" />
      </main>
    );
  }

  return (
    <ClickSpark sparkColor="#3b82f6" sparkSize={6} sparkRadius={14} sparkCount={6} duration={320}>
      <main className="onion-login-page grid min-h-screen bg-white dark:bg-slate-950 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="relative hidden overflow-hidden bg-[#0b1f46] p-12 text-white lg:flex lg:flex-col xl:p-16">
          <NetworkGlobe />
          <div className="relative flex items-center gap-3">
            <div className="grid h-12 w-10 place-items-center overflow-visible"><OnionMark color="#fff" className="h-12 w-12 scale-[1.2]" /></div>
            <div className="text-base font-semibold">{brandName}</div>
          </div>
          <div className="relative mt-16 w-full max-w-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-300">Aparência</span>
            <div className="mt-4 flex gap-7 border-b border-white/15" role="group" aria-label="Aparência">
              {APPEARANCES.map(item => (
                <button key={item.value} type="button" aria-pressed={appearance === item.value} onClick={() => setAppearance(item.value)} className={`-mb-px border-b-2 pb-3 text-xs font-semibold transition ${appearance === item.value ? 'border-white text-white' : 'border-transparent text-blue-200/65 hover:text-white'}`}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <footer className="relative mt-auto grid grid-cols-3 divide-x divide-white/15 border-t border-white/15 pt-5 text-center">
            <Meta label="Build" value={build} />
            <Meta label="Uptime" value={formatUptime(uptime)} mono />
            <Meta label="Região" value={region} />
          </footer>
        </section>

        <section className="relative flex items-center justify-center bg-[linear-gradient(90deg,#f4f8ff_0%,#fff_24%,#fff_100%)] p-6 sm:p-10 lg:justify-start lg:pl-[clamp(72px,8vw,120px)] lg:pr-12 dark:bg-[linear-gradient(90deg,#0b1427_0%,#020617_24%,#020617_100%)]">
          <div className="relative w-full max-w-[420px]">
            <div className="mb-9">
              <div className="mb-5 flex h-12 w-10 items-center justify-center overflow-visible lg:hidden"><OnionMark label={brandName} className="h-12 w-12 scale-[1.2]" /></div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{title}</h1>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Usuário" icon={<User />}><input autoFocus autoComplete="username" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></Field>
              <Field label="Senha" icon={<Lock />} trailing={<button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff /> : <Eye />}</button>}><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field>
              {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <SpecularButton type="submit" disabled={loading} size="md" radius={14} tint="#0f4fd6" tintOpacity={1} textColor="#fff" lineColor="#eff6ff" baseColor="#60a5fa" intensity={2.35} shineSize={18} shineFade={46} thickness={1.7} speed={0.38} followMouse proximity={280} autoAnimate={!loading} className="min-h-[52px] w-full text-sm font-semibold ring-1 ring-blue-300/25 shadow-[0_14px_36px_rgba(15,79,214,0.28)] hover:brightness-110">
                <span className="flex items-center justify-center gap-2">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><LogIn className="h-4 w-4" /> Entrar</>}</span>
              </SpecularButton>
            </form>
          </div>
        </section>
      </main>
    </ClickSpark>
  );
}

const Meta = ({ label, value, mono }) => <div><span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-300">{label}</span><strong className={`mt-1.5 block text-xs font-semibold text-white ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</strong></div>;

const Field = ({ label, icon, trailing, children }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
    <span className="login-field relative block">
      <span className="absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-slate-400 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {children}
      {trailing && <span className="absolute right-2.5 top-1/2 z-10 -translate-y-1/2 text-slate-400 [&_button]:p-1.5 [&_svg]:h-4 [&_svg]:w-4">{trailing}</span>}
    </span>
  </label>
);
