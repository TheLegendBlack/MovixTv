import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Indication de chargement sans animation, gradient ni boucle de rendu. */
export function LightweightLoading({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" className={cn('flex min-h-32 items-center justify-center px-4 py-6 text-sm text-gray-400', className)}>
      {t('common.loading')}
    </div>
  );
}
