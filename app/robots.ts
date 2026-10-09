import type { MetadataRoute } from 'next';

const SITE_ORIGIN = process.env.SITE_URL ?? 'https://cwot.jp';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/dev/',
    },
    sitemap: new URL('/sitemap.xml', SITE_ORIGIN).href,
  };
}
