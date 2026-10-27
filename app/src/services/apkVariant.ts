/**
 * Choix de l'APK d'une mise à jour (26/10/2026).
 *
 * Le manifeste garde l'APK universel dans `apkUrl` / `apkSha256` /
 * `apkSizeBytes` (anciennes applications, premier téléchargement) et peut
 * ajouter `apks` : une variante par processeur, ~20 Mo de moins. Module pur,
 * sans import natif, pour être testé par `node --test`.
 */

export type ApkVariant = {
  url: string;
  sha256: string;
  sizeBytes: number;
};

type ApkFields = {
  apkUrl: string;
  apkSizeBytes: number;
  apkSha256: string;
  apks?: Partial<Record<string, ApkVariant>>;
};

function isVariant(value: unknown): value is ApkVariant {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.url === 'string' &&
    v.url.startsWith('https://') &&
    typeof v.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(v.sha256) &&
    typeof v.sizeBytes === 'number' &&
    Number.isInteger(v.sizeBytes) &&
    v.sizeBytes > 0
  );
}

/**
 * `supportedAbis` est `Build.SUPPORTED_ABIS` (du préféré au moins bon). Sans
 * variante valide pour l'un d'eux, ou sans `apks`, les champs universels
 * restent : un manifeste sans `apks` (édition gratuite, GitHub) ne change pas.
 */
export function pickApkFields<T extends ApkFields>(
  manifest: T,
  supportedAbis: readonly string[],
): T {
  const apks = manifest.apks;
  if (typeof apks !== 'object' || apks === null) return manifest;
  for (const abi of supportedAbis) {
    const variant = apks[abi];
    if (isVariant(variant)) {
      return {
        ...manifest,
        apkUrl: variant.url,
        apkSha256: variant.sha256,
        apkSizeBytes: variant.sizeBytes,
      };
    }
  }
  return manifest;
}
