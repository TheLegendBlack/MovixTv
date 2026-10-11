export const CONFIG = {
  SITE_URL: 'https://movix.luxe',
  DNS_PRIMARY: '1.1.1.1',
  DNS_SECONDARY: '1.0.0.1',
  DNS_DOH_URL: 'https://cloudflare-dns.com/dns-query',
  APP_NAME: 'Movix',
  USER_AGENT:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  // Pas de token `Mobile` : c'est lui qui déclenche les layouts téléphone côté
  // site et chez les CDN. `Android TV` est le token que remontent les vraies
  // WebView leanback et sur lequel s'appuie la détection web en secours.
  USER_AGENT_TV:
    'Mozilla/5.0 (Linux; Android 14; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  USER_AGENT_IOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

/**
 * Build debug uniquement : charge le serveur Vite du poste de dev au lieu du
 * site publié, en court-circuitant la découverte rentry / address.json.
 *
 * `localhost` et non l'IP du poste : network_security_config.xml interdit le
 * HTTP en clair partout sauf sur localhost. Le pont se fait avec
 * `adb reverse tcp:3000 tcp:3000`, qui renvoie le localhost de la TV vers le Mac.
 *
 * Mettre à null pour qu'un build debug reparte sur le site publié.
 */
export const DEV_SITE_URL: string | null = 'http://localhost:3000';

export const UPDATE_CHECK = {
  RENTRY_URL: 'https://rentry.co/movix',
  MANIFEST_PATH: '/app/version.json',
  GITHUB_VERSION_RAW_PATH: '/raw/refs/heads/main/app/version.json',
  TIMEOUT_MS: 5000,
  PENDING_DOWNLOAD_KEY: 'update:pendingDownload',
};

// Repli quand rentry ou address.json sont injoignables (souvent le cas derrière
// un VPN, dont l'IP reçoit un défi Cloudflare). À garder aligné sur la liste
// « active » de address.json.
export const FALLBACK_CONFIG = {
  RESOLVER_HOSTS: ['movix.online'],
  PRIMARY_URL: 'https://movix.luxe',
  MIRRORS: [
    'https://movix.college',
    'https://movix.men',
    'https://movix.fun',
    'https://movix.show',
    'https://movix.date',
    'https://movix.chat',
    'https://movix.golf',
    'https://movix.cloud',
    'https://movix.cash',
  ],
  CACHE_KEY: 'address:lastConfig',
  GITHUB_URL: 'https://github.com/movixstream/MovixOpenSource',
  TELEGRAM_URL: 'https://t.me/ix_annonces',
};
