import { getSourcePriorityPrefs, updateCategory } from '@/utils/sourcePriorityPrefs';
import type { LanguageId } from '@/types/sourcePriority';

/**
 * Version préférée, VF ou VOSTFR (26/10/2026), choisie au premier lancement
 * comme dans l'appli TV native de Movix.
 *
 * Pas de réglage de plus : c'est l'ordre des langues des préférences de
 * sources (`sourcePriorityPrefs`), celui que suivent déjà le choix
 * automatique de la source et l'extraction. On met la langue choisie en
 * tête, l'autre juste après, pour les films et séries comme pour les animés.
 */

export type PreferredVersion = 'vf' | 'vostfr';

export function reorderLanguages<T extends { id: LanguageId; enabled: boolean }>(order: T[], first: PreferredVersion): T[] {
  const second: PreferredVersion = first === 'vf' ? 'vostfr' : 'vf';
  const pick = (id: PreferredVersion) => order.find(entry => entry.id === id);
  const head = [pick(first), pick(second)]
    .filter((entry): entry is T => entry !== undefined)
    .map(entry => ({ ...entry, enabled: true }));
  return [...head, ...order.filter(entry => entry.id !== first && entry.id !== second)];
}

export function getPreferredVersion(): PreferredVersion {
  const order = getSourcePriorityPrefs().categories.moviesTv.languageOrder;
  const vf = order.findIndex(entry => entry.id === 'vf');
  const vostfr = order.findIndex(entry => entry.id === 'vostfr');
  return vostfr >= 0 && (vf < 0 || vostfr < vf) ? 'vostfr' : 'vf';
}

export function setPreferredVersion(version: PreferredVersion): void {
  updateCategory('moviesTv', category => ({ ...category, languageOrder: reorderLanguages(category.languageOrder, version), pinnedLanguage: null }));
  updateCategory('anime', category => ({ ...category, languageOrder: reorderLanguages(category.languageOrder, version), pinnedLanguage: null }));
}
