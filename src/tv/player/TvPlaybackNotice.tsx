import React from 'react';
import type { TvPlaybackIssue } from './useTvPlaybackDiagnostic';

/**
 * Bandeau d'explication, affiché en permanence tant que le problème dure.
 *
 * Volontairement indépendant de la barre de lecture, qui se masque après
 * quelques secondes : ce message doit rester lisible, puisqu'il explique
 * précisément pourquoi il ne se passe rien à l'écran.
 */
export const TvPlaybackNotice: React.FC<{ issue: TvPlaybackIssue | null }> = ({ issue }) => {
  if (!issue) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center px-[5%] pt-[4%]">
      <div className="max-w-[720px] rounded-xl border-2 border-amber-400/50 bg-black/85 px-6 py-4">
        <p className="text-lg font-semibold leading-snug text-amber-300">
          {issue.code === 'audio-codec'
            ? 'Son indisponible'
            : issue.code === 'interrupted'
              ? 'Lecture interrompue'
              : 'Lecture impossible'}
        </p>
        <p className="mt-1 text-base leading-relaxed text-white/80">{issue.message}</p>
      </div>
    </div>
  );
};
