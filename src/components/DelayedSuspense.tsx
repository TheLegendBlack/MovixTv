import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useLightMode } from '@/context/LightModeContext';
import { LightweightLoading } from '@/components/LightweightLoading';

interface Props {
  delay?: number;
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * Suspense wrapper that delays the fallback display by N ms (default 200).
 *
 * Avoids the "fallback flash" on already-cached chunks: the fallback is
 * only revealed if the children take longer than `delay` to resolve.
 *
 * Implementation: a sibling component (DelayedFallback) does the timer,
 * Suspense itself just renders the timer-aware fallback.
 */
const DelayedFallback = ({ delay, children }: { delay: number; children: ReactNode }) => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return <>{show ? children : null}</>;
};

export const DelayedSuspense = ({ delay = 200, fallback, children }: Props) => {
  const { isLightMode } = useLightMode();
  return <Suspense fallback={isLightMode ? <LightweightLoading /> : <DelayedFallback delay={delay}>{fallback}</DelayedFallback>}>
    {children}
  </Suspense>;
};
