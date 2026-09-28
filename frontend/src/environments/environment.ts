export const environment = {
  // Relative so it works both under `ng serve` (proxied via proxy.conf.json)
  // and behind the nginx container, which proxies /api/ to the backend.
  apiUrl: '/api',
};
