/**
 * Ce qui distingue l'édition du shell. Version de l'édition MovixTv : mêmes
 * noms exportés que l'édition complète, comportement d'origine.
 */

import type { ImageSourcePropType } from 'react-native';

/** Nom affiché par le shell (écrans de mise à jour). */
export const EDITION_APP_NAME = 'Movix';

/**
 * `null` : découverte de l'adresse par rentry / address.json (le site Movix).
 * Pour votre propre application : l'adresse HTTPS où vous servez `dist/`.
 */
export const EDITION_SITE_URL: string | null = null;

/**
 * `null` : `version.json` du dépôt GitHub de Movix (adresse donnée par
 * address.json), qui propose l'APK Movix. Pour votre propre application :
 * l'adresse de votre `version.json`, ou `''` pour ne jamais vérifier.
 */
export const EDITION_UPDATE_MANIFEST_URL: string | null = null;

/** Faux : la mise à jour est proposée par une fenêtre avant d'être téléchargée. */
export const EDITION_AUTO_UPDATE = false;

/** Logo des écrans du shell (mise à jour) : l'icône de l'application. */
// Image embarquée par Metro : `require` est la seule façon de la désigner.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const EDITION_LOGO: ImageSourcePropType = require('../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png');
