import type { NextConfig } from 'next';
import { APP_VIEWS, viewToPath } from './lib/appPaths';

const nextConfig: NextConfig = {
  async redirects() {
    return APP_VIEWS.filter((view) => view !== 'home').map((view) => ({
      source: `/${view}`,
      destination: viewToPath(view),
      permanent: false,
    }));
  },
};

export default nextConfig;
