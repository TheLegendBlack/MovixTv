import { NativeModules, Platform } from 'react-native';
import { getLocalVersionName } from './apkInstaller';
import { getNetworkJournal, isNetworkJournalEnabled } from './networkJournal';
import { clipboardDiagnosticText, getCastDiagnostics, redactDiagnosticText } from './diagnosticReport';

type DiagnosticModule = {
  copyDiagnosticText(text: string): Promise<void>;
  shareDiagnosticText(text: string): Promise<boolean>;
};

function nativeDiagnostics(): DiagnosticModule {
  const module = NativeModules.MediaProxy as DiagnosticModule | undefined;
  if (!module?.copyDiagnosticText || !module.shareDiagnosticText) {
    throw new Error('DIAGNOSTICS_UNAVAILABLE');
  }
  return module;
}

export async function buildDiagnosticReport(includeNetwork = true): Promise<string> {
  const [version, network] = await Promise.all([
    getLocalVersionName().catch(() => 'inconnue'),
    includeNetwork ? getNetworkJournal() : Promise.resolve([]),
  ]);
  return [
    'Movix — diagnostic',
    `Date : ${new Date().toISOString()}`,
    `Application : ${version} · ${Platform.OS} ${Platform.Version}`,
    `Capture réseau : ${isNetworkJournalEnabled() ? 'activée' : 'désactivée'}`,
    'Les paramètres des URL, cookies et en-têtes sensibles reconnus sont masqués.',
    '',
    '=== Cast ===',
    ...getCastDiagnostics(),
    ...(includeNetwork ? ['', '=== Réseau ===', ...network.map(redactDiagnosticText)] : []),
  ].join('\n');
}

export async function copyDiagnostics(includeNetwork = true): Promise<void> {
  const report = await buildDiagnosticReport(includeNetwork);
  await nativeDiagnostics().copyDiagnosticText(clipboardDiagnosticText(report));
}

export async function shareDiagnostics(): Promise<boolean> {
  return nativeDiagnostics().shareDiagnosticText(await buildDiagnosticReport());
}
