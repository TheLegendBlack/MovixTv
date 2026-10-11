import { useTranslation } from 'react-i18next';

export default function AdWaitingScreen() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-full bg-black">
      {/* Textes conservés, sans affichage derrière la popup. */}
      <div hidden>
        <div className="text-white text-2xl font-bold mb-4">{t('watch.loading')}</div>
        <div className="text-gray-400 text-lg">{t('watch.pleaseWait')}</div>
      </div>
    </div>
  );
}
