import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  Clipboard,
  CloudOff,
  Download,
  HandCoins,
  Heart,
  Menu,
  Moon,
  Package,
  ReceiptText,
  RotateCcw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Timer,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';

const APK_URL = 'https://github.com/Pezush/ReturnBond/releases/download/v1.1.0/ReturnBond-v1.8.4.apk';
const UPI_ID = 'pijush4895m@okaxis';
const UPI_URL = 'upi://pay?pa=pijush4895m@okaxis&pn=Pijush%20Mandal&cu=INR';
const PHONE_IMAGE = '/images/file_000000001ebc81fb938f265e982f5cc8.png';

type Page = 'home' | 'privacy' | 'terms';
type Theme = 'light' | 'dark' | 'system';

const benefits = [
  { icon: Wallet, title: 'Money tracking', text: 'Keep track of money you lend and borrow.' },
  { icon: Package, title: 'Item tracking', text: 'Track physical items you lend or borrow.' },
  { icon: Send, title: 'Shared requests', text: 'Connect two people through ReturnBond requests.' },
  { icon: CheckCircle2, title: 'Confirmations', text: 'Payments and item returns require confirmation.' },
  { icon: Timer, title: 'Reminders', text: 'Keep track of upcoming due dates and overdue records.' },
  { icon: CloudOff, title: 'Offline support', text: 'Keep local records and reminders even without internet.' },
];

const features = [
  ['Money lending', 'Track money you lend to others.', Wallet],
  ['Money borrowing', 'Keep track of money you borrow.', HandCoins],
  ['Item lending', 'Record physical items you give temporarily.', Package],
  ['Item borrowing', 'Track things you have borrowed.', RotateCcw],
  ['Payment tracking', 'Track reported and confirmed payments.', ReceiptText],
  ['Return confirmation', 'Borrowers report returns and lenders confirm receipt.', CheckCircle2],
  ['Requests', 'Send and receive lending or borrowing requests.', Send],
  ['Notifications', 'Stay informed about requests, payments and returns.', Bell],
  ['Reminders', 'Upcoming due dates and overdue notifications.', Timer],
  ['Offline records', 'Keep local records and reminders when offline.', CloudOff],
] as const;

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

function useScrollReveal() {
  useEffect(() => {
    const elements = document.querySelectorAll('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
      elements.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });
}

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (locked) {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = original; };
    }
  }, [locked]);
}

function App() {
  const [page, setPage] = useState<Page>('home');
  const [theme, setTheme] = useState<Theme>('system');
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [donateMessage, setDonateMessage] = useState('');

  useScrollReveal();
  useBodyScrollLock(menuOpen);

  const copyUpi = async () => {
    await navigator.clipboard.writeText(UPI_ID);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2400);
  };

  const openDonation = () => {
    setDonateMessage('If your UPI app did not open, copy the UPI ID below to pay from any supported app.');
    window.location.href = UPI_URL;
  };

  const navigate = (target: Page, section?: string) => {
    setPage(target);
    setMenuOpen(false);
    window.setTimeout(() => section && scrollToId(section), 20);
  };

  return (
    <div className={`site-shell theme-${theme}`}>
      <div className="announcement"><Sparkles size={14} /> Built for clear conversations and confident returns <span>•</span> Android 7.0+</div>
      <header className="navbar">
        <button className="brand" onClick={() => navigate('home')} aria-label="ReturnBond home">
          <span className="brand-mark"><HandCoins size={19} /></span>
          <span>Return<span>Bond</span></span>
        </button>
        <nav className={`nav-links ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
          <button onClick={() => navigate('home', 'features')}>Features</button>
          <button onClick={() => navigate('home', 'how-it-works')}>How it works</button>
          <button onClick={() => navigate('home', 'download')}>Download</button>
          <button onClick={() => navigate('home', 'about')}>About</button>
          <a href={APK_URL} className="button button-primary mobile-menu-cta">Download ReturnBond <Download size={16} /></a>
          <div className="mobile-theme-picker"><ThemeSwitcher theme={theme} setTheme={setTheme} /></div>
        </nav>
        <div className="nav-actions">
          <ThemeSwitcher theme={theme} setTheme={setTheme} />
          <button className="button button-small button-dark" onClick={() => navigate('home', 'download')}>Download <ArrowRight size={15} /></button>
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu" aria-expanded={menuOpen}>{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      {page === 'home' ? <HomePage navigate={navigate} copyUpi={copyUpi} copied={copied} openDonation={openDonation} donateMessage={donateMessage} /> : <LegalPage page={page} navigate={navigate} />}

      <footer className="footer">
        <div className="footer-top">
          <div><button className="brand footer-brand" onClick={() => navigate('home')}><span className="brand-mark"><HandCoins size={19} /></span><span>Return<span>Bond</span></span></button><p className="footer-tagline">Give. Track. Return.</p><p className="footer-credit">Created &amp; Developed by Pijush Mandal<br /><span>Independent Developer</span></p></div>
          <div className="footer-links"><div><strong>Explore</strong><button onClick={() => navigate('home', 'features')}>Features</button><button onClick={() => navigate('home', 'how-it-works')}>How it works</button><button onClick={() => navigate('home', 'download')}>Download</button><button onClick={() => navigate('home', 'about')}>About</button></div><div><strong>Information</strong><button onClick={() => navigate('privacy')}>Privacy Policy</button><button onClick={() => navigate('terms')}>Terms</button><button onClick={() => navigate('home', 'support')}>Support development</button></div></div>
          <div className="footer-upi"><strong>Support development</strong><p>UPI ID</p><button onClick={copyUpi} className="upi-copy">{UPI_ID} <Clipboard size={14} /></button></div>
        </div>
        <div className="footer-bottom"><span>© 2026 ReturnBond. All rights reserved.</span><span>Made with care for better conversations.</span></div>
      </footer>
    </div>
  );
}

function ThemeSwitcher({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
  return <div className="theme-switcher" aria-label="Theme preference"><button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')} aria-label="Light mode"><Sun size={15} /></button><button className={theme === 'system' ? 'active' : ''} onClick={() => setTheme('system')} aria-label="System theme"><Smartphone size={14} /></button><button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')} aria-label="Dark mode"><Moon size={14} /></button></div>;
}

function PhoneVisual({ large = false }: { large?: boolean }) {
  return <div className={`phone-wrap ${large ? 'phone-large' : ''}`}><div className="phone-glow" /><img src={PHONE_IMAGE} alt="ReturnBond app dashboard shown inside a smartphone" loading="lazy" /></div>;
}

function HomePage({ navigate, copyUpi, copied, openDonation, donateMessage }: { navigate: (page: Page, section?: string) => void; copyUpi: () => void; copied: boolean; openDonation: () => void; donateMessage: string }) {
  return <main>
    <section className="hero section-pad"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot" /> Official ReturnBond website</div><h1>Give. Track.<br /><em>Return.</em></h1><p className="hero-lede">Keep track of everything you lend and borrow — from money to everyday items — with simple records, shared confirmations and reminders.</p><div className="hero-actions"><a href={APK_URL} className="button button-primary">Download ReturnBond <Download size={17} /></a><button className="button button-quiet" onClick={() => navigate('home', 'support')}>Support development <Heart size={16} /></button></div><div className="download-meta"><span><ShieldCheck size={15} /> Official APK</span><span>Version 1.8.4</span><span>Android 7.0+</span></div></div><div className="hero-visual"><div className="visual-label"><span>01</span><span>YOUR LENDING OVERVIEW</span></div><PhoneVisual /></div></section>
    <section className="trust-strip"><span>Simple by design</span><span>Clear records</span><span>Shared confirmations</span><span>Offline-friendly</span></section>
    <section className="section-pad why-section" id="features" data-reveal><div className="section-heading"><div><div className="eyebrow">Why ReturnBond?</div><h2>Less uncertainty.<br /><span>More clarity.</span></h2></div><p>Whether it is money, a book, or something in between, ReturnBond gives every promise a place to live — and both sides a clearer way forward.</p></div><div className="benefit-grid">{benefits.map(({ icon: Icon, title, text }, i) => <article className="benefit-card" key={title} data-reveal style={{ transitionDelay: `${i * 80}ms` }}><div className="icon-tile"><Icon size={20} /></div><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <section className="section-pad process-section" id="how-it-works" data-reveal><div className="section-heading centered"><div><div className="eyebrow">How ReturnBond works</div><h2>From promise to <span>peace of mind.</span></h2></div><p>A simple flow that keeps everyone on the same page, without making everyday lending feel complicated.</p></div><div className="steps">{[['01', 'Create', 'Record money or an item.', Wallet], ['02', 'Connect', 'Send a request using a ReturnBond ID.', Send], ['03', 'Track', 'Monitor payments, returns, due dates and status.', Timer], ['04', 'Confirm', 'Both sides confirm important actions.', CheckCircle2]].map(([number, title, text, Icon], i) => <div className="step" key={number as string} data-reveal style={{ transitionDelay: `${i * 100}ms` }}><span className="step-number">{number as string}</span><div className="step-icon"><Icon size={20} /></div><h3>{title as string}</h3><p>{text as string}</p></div>)}</div></section>
    <section className="feature-section section-pad" data-reveal><div className="section-heading centered"><div><div className="eyebrow">Made for real life</div><h2>Everything you need to<br /><span>keep things clear.</span></h2></div></div><div className="feature-grid" id="feature-cards">{features.map(([title, text, Icon], i) => <article className="feature-card" key={title} data-reveal style={{ transitionDelay: `${(i % 2) * 80}ms` }}><Icon size={20} /><div><h3>{title}</h3><p>{text}</p></div><ArrowRight className="feature-arrow" size={17} /></article>)}</div></section>
    <section className="preview-section section-pad" data-reveal><div className="preview-copy"><div className="eyebrow">Inside ReturnBond</div><h2>A calmer way to stay on top of what matters.</h2><p>The home screen puts your lending overview, quick actions and upcoming dues in one thoughtful view. Open your records, requests, alerts and settings whenever you need them.</p><div className="preview-list"><span><Check size={16} /> Net outstanding at a glance</span><span><Check size={16} /> Quick actions for money and items</span><span><Check size={16} /> Upcoming dues without the noise</span></div></div><div className="preview-visual"><PhoneVisual large /></div></section>
    <section className="notification-section section-pad" data-reveal><div className="notification-card"><div className="notification-copy"><div className="eyebrow">Stay in the loop</div><h2>Important moments,<br /><span>right when they happen.</span></h2><p>ReturnBond can notify you about new and accepted requests, payment and return reports, confirmations, due dates, overdue records and completed transactions.</p></div><div className="notification-list">{['New lending requests', 'Payment confirmations', 'Item return reports', 'Due dates & overdue records', 'Completed transactions'].map((item, index) => <div key={item}><span>0{index + 1}</span>{item}<CheckCircle2 size={17} /></div>)}</div></div></section>
    <section className="offline-section section-pad" data-reveal><div className="offline-icon"><CloudOff /></div><div><div className="eyebrow">Offline-first thinking</div><h2>Your records stay close.</h2><p>ReturnBond supports local record keeping, so your records and reminders can remain available even without an internet connection. Offline actions are not assumed to sync automatically.</p></div></section>
    <section className="support-section section-pad" id="support" data-reveal><div className="support-card"><div><div className="eyebrow">Keep it independent</div><h2>Support development.</h2><p>ReturnBond is independently developed and maintained. If you find it useful, you can support its continued development.</p><div className="developer"><div className="avatar"><UserRound size={22} /></div><div><strong>Pijush Mandal</strong><span>Independent Developer</span></div></div></div><div className="support-actions"><span className="upi-label">UPI ID</span><button className="upi-id" onClick={copyUpi}>{UPI_ID}<Clipboard size={16} /></button>{copied && <div className="copied"><Check size={15} /> UPI ID copied</div>}<button className="button button-primary" onClick={openDonation}>Donate via UPI <Heart size={16} /></button>{donateMessage && <p className="donate-message">{donateMessage}</p>}</div></div></section>
    <section className="about-section section-pad" id="about" data-reveal><div className="about-mark"><HandCoins size={28} /></div><div><div className="eyebrow">About ReturnBond</div><h2>Give. Track. Return.</h2><p>ReturnBond is a simple lending and borrowing management app designed to help people keep track of money and everyday items they lend or borrow.</p><div className="about-meta"><span>Created &amp; Developed by Pijush Mandal</span><span>Version 1.8.4</span><span>Android 7.0+</span></div></div></section>
    <section className="download-section section-pad" id="download" data-reveal><div className="download-inner"><div className="eyebrow">Ready when you are</div><h2>Keep the next return<br /><span>clear and simple.</span></h2><p>Download the official ReturnBond APK and start keeping better records.</p><a href={APK_URL} className="button button-light">Download ReturnBond <Download size={17} /></a><small>Official APK • Version 1.8.4 • Android 7.0+</small></div></section>
  </main>;
}

function LegalPage({ page, navigate }: { page: 'privacy' | 'terms'; navigate: (page: Page, section?: string) => void }) {
  const privacy = page === 'privacy';
  return <main className="legal-page"><div className="legal-hero section-pad"><button className="back-link" onClick={() => navigate('home')}><ArrowRight size={16} className="back-arrow" /> Back to ReturnBond</button><div className="eyebrow">ReturnBond information</div><h1>{privacy ? 'Privacy Policy' : 'Terms of Service'}</h1><p>Simple, plain-language information for ReturnBond users.</p><span className="last-updated">Last updated September 2026</span></div><article className="legal-content">{privacy ? <><h2>Privacy at a glance</h2><p>ReturnBond is designed to help you manage lending and borrowing records. We aim to collect and use only the information needed for the app to work.</p><h2>Information and services</h2><p>Depending on how you use the Android app, this can include account information, authentication details, transaction records, due dates, notifications and device information required for app functionality. Firebase services may be used by the ReturnBond Android app where applicable for authentication, data services and notifications.</p><h2>Your control</h2><p>You remain in control of your records. You can review your information and request account deletion through the available app support channels. We do not sell personal data.</p><h2>Security and third parties</h2><p>Reasonable safeguards are used to protect information. Third-party services, including Firebase where applicable, process information only to provide services used by the app and under their own policies. No online service can promise absolute security.</p><h2>Questions</h2><p>For questions about privacy or account deletion, contact the developer through the official ReturnBond support channel.</p></> : <><h2>Purpose</h2><p>ReturnBond helps people keep personal records of money and items they lend or borrow. It is a record-keeping tool, not a bank, escrow service or legal adviser.</p><h2>Your responsibility</h2><p>You are responsible for using accurate records, protecting your account, and checking details before confirming a payment, request or return. Lending and borrowing disputes remain between the people involved.</p><h2>Payments and items</h2><p>Users remain responsible for payment obligations, item care and item returns. ReturnBond does not guarantee that another person will pay, return an item or agree with a record.</p><h2>Acceptable use</h2><p>Do not misuse the service, impersonate another person, submit unlawful content, interfere with the app, or use it to deceive, harass or harm others.</p><h2>Availability and changes</h2><p>The service may change, be interrupted or become unavailable. We may update these terms as ReturnBond evolves. Continued use after an update means you accept the updated terms.</p><h2>Limitation</h2><p>To the extent allowed by law, ReturnBond and its independent developer are not responsible for losses arising from inaccurate records, lending disputes, payment failures, item loss or service interruptions.</p></>}</article></main>;
}

export default App;
