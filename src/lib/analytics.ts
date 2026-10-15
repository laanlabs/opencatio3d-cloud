// Consent-aware analytics for the web planner (Google Analytics 4 via gtag.js; Firebase project
// opencatio3d). Same rules as opencatio3d.com:
//   - nothing loads and no cookie is set until the visitor clicks "Allow analytics";
//   - Global Privacy Control is a standing "no";
//   - advertising features are off;
//   - with no measurement id configured (GA_MEASUREMENT_ID = ''), nothing is ever loaded or asked.
// Privacy: designs live in the URL fragment (#/view/v1/<payload>) and IndexedDB, so this module NEVER
// sends location.href or the hash. Page views carry only a fixed screen name; events only fixed labels.

export const GA_MEASUREMENT_ID = '';
const KEY = 'oc3d-planner-consent';

export type Consent = 'granted' | 'denied' | null;
type Props = Record<string, string | number | boolean>;
interface GaWindow extends Window {
  gtag?: (...args: unknown[]) => void;
  dataLayer?: unknown[];
}

/** Screens the planner reports. */
export type Screen = 'home' | 'editor' | 'view' | 'print' | 'build' | 'import' | 'missing' | 'quest' | 'prowl';

export const analyticsEnabled = () => GA_MEASUREMENT_ID !== '';

export function readConsent(): Consent {
  if (typeof window === 'undefined') return null;
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return 'denied';
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

let loaded = false;
let current: Screen | null = null;

export function loadAnalytics() {
  if (loaded || !analyticsEnabled() || typeof window === 'undefined' || readConsent() !== 'granted') return;
  loaded = true;
  const w = window as GaWindow;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  w.gtag('js', new Date());
  w.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false, anonymize_ip: true, page_location: `${location.origin}/` });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);
  if (current) sendScreen(current);
}

export function writeConsent(v: 'granted' | 'denied') {
  try { localStorage.setItem(KEY, v); } catch { /* storage blocked: the choice lasts for this page view */ }
  if (v === 'granted') loadAnalytics();
  else (window as GaWindow).gtag?.('consent', 'update', { analytics_storage: 'denied' });
}

function sendScreen(screen: Screen) {
  const path = `/${screen}`;
  (window as GaWindow).gtag?.('event', 'page_view', { page_title: `OpenCatio3D planner · ${screen}`, page_location: `${location.origin}${path}`, page_path: path });
}

/** Records the screen being shown. Only the fixed screen name is sent, never the URL. */
export function trackScreen(screen: Screen) {
  if (screen === current) return;
  current = screen;
  if (loaded) sendScreen(screen);
}

/** A fixed-label event, e.g. track('export', { kind: 'print' }). Never pass user content. */
export function track(event: string, props: Props = {}) {
  if (!loaded) return;
  (window as GaWindow).gtag?.('event', event, props);
}
