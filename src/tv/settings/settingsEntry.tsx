import React from 'react';
import type { TvIconName, TvTone } from './kit';

/**
 * Une ligne de la page Paramètres, et le détail montré à droite quand elle a
 * le focus. Partagé entre les réglages du socle (`TvSettings.tsx`) et ceux
 * qu'ajoute une édition (`tv/edition.tsx`).
 */
export interface SettingsEntry {
  id: string;
  group: string;
  label: string;
  icon: TvIconName;
  value?: string;
  tone?: TvTone;
  toggle?: boolean;
  chevron?: boolean;
  description: React.ReactNode;
  details?: React.ReactNode;
  /** Ce que fait OK, rappelé en bas du panneau. */
  action: string;
  onSelect: () => void;
}

export const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;

/** Clé ou identifiant affiché dans le détail, en chasse fixe. */
export const KeyLine: React.FC<{ value: string }> = ({ value }) => (
  <p className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-1.5 font-mono text-[14px] tracking-wider text-white/80">
    {value}
  </p>
);
