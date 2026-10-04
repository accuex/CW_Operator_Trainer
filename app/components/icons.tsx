import type { SVGProps } from 'react';

export type IconName =
  | 'home' | 'learn' | 'train' | 'queue' | 'analysis' | 'exam' | 'collection' | 'settings' | 'account'
  | 'play' | 'stop' | 'pause' | 'flame' | 'star' | 'check' | 'x' | 'lock' | 'key' | 'chevron-right'
  | 'chevron-left' | 'volume' | 'sparkle' | 'trophy' | 'target' | 'bolt' | 'repeat' | 'ear' | 'printer'
  | 'eye' | 'eye-off' | 'fingerprint' | 'logout';

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-6h4v6" /></>,
  learn: <><rect x="3" y="5" width="11" height="15" rx="2" /><path d="M8 3h11a2 2 0 0 1 2 2v13" /><path d="M7 10h3M7 14h3" /></>,
  train: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="5" height="7" rx="2" /><rect x="16" y="14" width="5" height="7" rx="2" /></>,
  queue: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /><path d="m3 17.5 9 5 9-5" opacity=".55" /></>,
  analysis: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  exam: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 13h7M9 17h5" /></>,
  collection: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><path d="m17 13 1.2 2.6 2.8.3-2.1 1.9.6 2.8-2.5-1.5-2.5 1.5.6-2.8-2.1-1.9 2.8-.3z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  account: <><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  key: <><circle cx="8" cy="14" r="3" /><path d="M10.5 12.5 20 3l2 2-2 2 2 2-3 1-2-2-2 2z" /></>,
  play: <path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor" stroke="none" /></>,
  flame: <path d="M12 2.5c.5 3.2 4.5 5.4 4.5 10A4.5 4.5 0 0 1 12 21a5.5 5.5 0 0 1-5.5-5.5c0-2.6 1.4-4.3 2.6-5.6.2 1.6 1 2.6 2 3 0-3.6-.4-6.6.9-10.4Z" fill="currentColor" stroke="none" />,
  star: <path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" fill="currentColor" stroke="none" />,
  check: <path d="m4.5 12.5 5 5L20 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  volume: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  sparkle: <path d="M12 2c.6 4.8 2.7 7.1 8 8-5.3.9-7.4 3.2-8 8-.6-4.8-2.7-7.1-8-8 5.3-.9 7.4-3.2 8-8Z" fill="currentColor" stroke="none" />,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M9 17h6v4H9z" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none" />,
  repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
  ear: <><path d="M6 9a6 6 0 1 1 11.5 2.4c-.9 1.8-2.5 2.6-3 4.1-.5 1.6-.4 3.5-2.5 4.5A3 3 0 0 1 7.6 18" /><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2-1.5 3.5" /></>,
  printer: <><path d="M6 9V3h12v6" /><path d="M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="6" y="13" width="12" height="8" rx="1.5" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  'eye-off': <><path d="M3 3l18 18" /><path d="M10.6 10.6a2.5 2.5 0 0 0 3.5 3.5" /><path d="M9.4 5.4A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-4.2 4.8M6.1 6.1A17.5 17.5 0 0 0 2 12s3.5 7 10 7a10.3 10.3 0 0 0 4.3-.9" /></>,
  fingerprint: <><path d="M12 11a3 3 0 0 1 3 3v1.5" /><path d="M9 14.5V14a3 3 0 0 1 4.5-2.6" /><path d="M7 16.5V14a5 5 0 0 1 9.5-2.2" /><path d="M5.5 18V14a6.5 6.5 0 0 1 12.4-2.8" /><path d="M12 14v5" /><path d="M9.5 20.5c.7.3 1.5.5 2.5.5a7 7 0 0 0 5-2.1" /></>,
  logout: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M15 12H8" /><path d="m13 8 4 4-4 4" /></>,
};

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
