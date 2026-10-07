/** Trainer SPA lives under `/app`. `/` is the public landing page. */

export const APP_BASE = '/app';

export const APP_VIEWS = [
  'home',
  'learn',
  'train',
  'levelup',
  'queue',
  'analysis',
  'exam',
  'communication',
  'geography',
  'english',
  'houki',
  'qso',
  'collection',
  'settings',
  'account',
] as const;

export type AppView = (typeof APP_VIEWS)[number];

const VIEW_SET = new Set<string>(APP_VIEWS);

export function viewToPath(view: AppView): string {
  return view === 'home' ? APP_BASE : `${APP_BASE}/${view}`;
}

export function pathToView(path: string): AppView {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'app') return 'home';
  const section = parts[1];
  return section && VIEW_SET.has(section) ? (section as AppView) : 'home';
}
