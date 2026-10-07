import type { MetadataRoute } from 'next';
import { APP_VIEWS, viewToPath } from '@/lib/appPaths';

const SITE_ORIGIN = process.env.SITE_URL ?? 'https://cw.conagi.jp';

const PATHS = ['/', '/sitemap', ...APP_VIEWS.map((view) => viewToPath(view))];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({
    url: new URL(path, SITE_ORIGIN).href,
  }));
}
