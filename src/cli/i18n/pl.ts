import type { MessageKey } from './en.js';

/**
 * Command names, environment variables, file paths and flags are deliberately
 * left untranslated: they are things the reader has to type back.
 */
export const pl: Record<MessageKey, string> = {
  'cli.description':
    'Lokalny serwer MCP o otwartym kodzie, delegujący rutynowe zadania programistyczne lokalnym agentom roboczym',
  'cli.cmd.setup':
    'Utwórz katalog konfiguracji Gelada MCP, katalogi danych i domyślny plik ustawień',
  'cli.cmd.doctor': 'Sprawdź, czy Gelada, Git i CLI workera są gotowe do wykonywania zadań',
  'cli.cmd.config': 'Przejrzyj, odczytaj lub zmień ustawienia Gelada MCP',
  'cli.cmd.task': 'Przejrzyj, zastosuj lub odrzuć delegowane zadania',
  'cli.cmd.taskInspect': 'Pokaż metadane, status, różnice lub logi delegowanego zadania',
  'cli.cmd.taskPatch': 'Zastosuj poprawkę lub plik patch do aktywnego zadania',
  'cli.cmd.taskDiscard': 'Anuluj działające zadanie, zatrzymaj nadzorców i odrzuć zmiany w worktree',
  'cli.cmd.mcp': 'Zarządzanie serwerem Gelada MCP i jego uruchamianie',
  'cli.cmd.mcpServe': 'Uruchom serwer Gelada MCP przez transport stdio',
  'cli.cmd.cleanup': 'Usuń nieaktualne artefakty zadań zgodnie z polityką przechowywania',
  'cli.cmd.models': 'Wypisz modele workera dostępne do delegowania',
  'cli.cmd.update': 'Sprawdź, czy jest nowsze wydanie, i opcjonalnie je zainstaluj',
  'cli.cmd.init': 'Zapisz startowy plik .gelada/policy.yaml w bieżącym repozytorium',
  'cli.cmd.smoke': 'Zdeleguj próbne zadanie od początku do końca i zgłoś, czy zadziałało',
  'cli.cmd.debugBundle': 'Zbierz migawkę środowiska do zgłoszenia błędu',

  'opt.json': 'Wypisz w formacie JSON',
  'opt.verbose': 'Pokaż szczegóły każdej kontroli',

  'cli.bareInvocation':
    'gelada: serwer MCP uruchomiony bez argumentów. W konfiguracji klienta podaj args ["mcp", "serve"].',

  'doctor.title': '=== Diagnostyka Gelada ===',
  'doctor.node.name': 'Wersja Node.js',
  'doctor.node.ok': 'Node.js {version}',
  'doctor.node.tooOld': 'Node.js {version} jest starszy niż wymagany v{required}',
  'doctor.node.platform': 'Platforma: {platform} {release} ({arch})',
  'doctor.node.fix': 'Zainstaluj Node.js v{required} lub nowszy.',
  'doctor.git.name': 'Git CLI',
  'doctor.git.missing': 'nie znaleziono git w PATH',
  'doctor.git.detail': 'Wymagany do izolowanych worktree (git worktree).',
  'doctor.git.fix':
    'Zainstaluj Git 2.30 lub nowszy: Gelada izoluje każde zadanie w osobnym git worktree.',
  'doctor.config.name': 'Katalog konfiguracji',
  'doctor.config.missing': 'Jeszcze nie utworzono: {path}',
  'doctor.config.unwritable': 'Brak prawa odczytu/zapisu: {path}',
  'doctor.config.dirs': 'Katalog konfiguracji: {config}',
  'doctor.config.dataDir': 'Katalog danych:      {data}',
  'doctor.config.logDir': 'Katalog logów:       {log}',
  'doctor.config.fixSetup': 'Uruchom "gelada setup", aby utworzyć konfigurację.',
  'doctor.config.fixPermissions': 'Popraw uprawnienia do {path}.',
  'doctor.registration.name': 'Rejestracja w klientach MCP',
  'doctor.registration.unreadable': 'Nie udało się odczytać konfiguracji klientów: {error}',
  'doctor.registration.none': 'Żaden wykryty klient MCP nie ma zarejestrowanej Gelady',
  'doctor.registration.noneDetail':
    'Klienci skonfigurowani ręcznie oraz ci, których Gelada nie wykrywa, nie są tu widoczni.',
  'doctor.registration.noneFix':
    'Uruchom "gelada setup", aby zarejestrować Geladę w klientach na tej maszynie.',
  'doctor.registration.allBroken':
    'Zapisane polecenie uruchomienia już nie istnieje (klientów: {count})',
  'doctor.registration.someBroken':
    '{broken} z {total} rejestracji wskazuje na nieistniejące polecenie',
  'doctor.registration.brokenDetail': '{client}: {command} — nie znaleziono ({path})',
  'doctor.registration.brokenFix':
    'Uruchom "gelada setup", aby zapisać rejestrację z aktualną ścieżką do interpretera.',
  'doctor.registration.okOne': 'Rejestracja w 1 kliencie jest poprawna',
  'doctor.registration.okMany': 'Rejestracje w {count} klientach są poprawne',
  'doctor.worker.name': 'CLI workera',
  'doctor.worker.missing': 'nie znaleziono {command} lub nie udało się go uruchomić',
  'doctor.worker.resolvedFrom': 'Ustalono przez {source}.',
  'doctor.worker.fix':
    'Zainstaluj Antigravity CLI i dodaj go do PATH albo wskaż ścieżkę w AGY_COMMAND.',
  'doctor.auth.name': 'Uwierzytelnienie workera',
  'doctor.auth.ok': 'Dostępnych modeli: {count}',
  'doctor.auth.unknown': 'Nie udało się pobrać listy modeli z CLI workera',
  'doctor.auth.fix':
    'Uruchom raz "{command}" w terminalu i zaloguj się, a potem powtórz "gelada doctor".',
  'doctor.details': '       Szczegóły:',
  'doctor.status': 'Stan systemu: {status}',
  'doctor.statusHint':
    'Uruchom "gelada setup", aby naprawić konfigurację, albo zajmij się pozycjami powyżej.',
  'doctor.footer': 'Gelada {version} · {runtime} {nodeVersion}',
  'doctor.opt.noWorker': 'Pomiń kontrole CLI workera',
  'doctor.opt.strict': 'Zakończ kodem niezerowym, jeśli którakolwiek kontrola nie przejdzie',

  'update.title': '=== Aktualizacja Gelada ===',
  'update.current': 'Bieżąca wersja:  v{version}',
  'update.latest': 'Najnowsza wersja: v{version}',
  'update.status': 'Stan:             {status}',
  'update.upToDate': 'Aktualna',
  'update.available': 'Dostępna aktualizacja',
  'update.checkFailed': 'Nie udało się sprawdzić aktualizacji: {error}',
  'update.currentOnly': 'Bieżąca wersja: v{version}',
  'update.howTo': 'Uruchom `gelada update --install` albo zaktualizuj ręcznie:',
  'update.releaseNotes': 'Opis wydania: {url}',
  'update.starting': 'Aktualizacja z v{from} do v{to}...',
  'update.viaNpm': 'Wykryto instalację npm. Uruchamiam npm install -g gelada-mcp@latest...',
  'update.npmDone': 'Aktualizacja przez npm zakończona.',
  'update.installing': 'Instalowanie v{version} w {dir}...',
  'update.done': 'Aktualizacja zakończona. {path} to teraz v{version}.',
  'update.failed': 'Aktualizacja nie powiodła się: {error}',
  'update.opt.install': 'Zainstaluj najnowszą aktualizację, jeśli jest dostępna',

  'setup.permissions.heading': 'Uprawnienia workera',
  'setup.permissions.body':
    'Antigravity CLI nie może prosić o zgodę na użycie narzędzi, gdy działa\n' +
    'bezgłowo, i w tym trybie ignoruje własne reguły zezwoleń. Dlatego Gelada\n' +
    'uruchamia go z wyłączonymi pytaniami o uprawnienia — bez tego worker nie\n' +
    'zapisze ani jednego pliku.\n\n' +
    'Co ogranicza go zamiast tego: worker widzi wyłącznie jednorazowy git worktree,\n' +
    'jego środowisko jest pozbawione poświadczeń, a polecenia terminala działają\n' +
    'w piaskownicy. Twoje drzewo robocze nigdy nie jest mu udostępniane.\n\n' +
    'Można to wyłączyć dla pojedynczego projektu przez workerAutoApprove: false w\n' +
    '.gelada/policy.yaml — delegowanie przestanie wtedy działać. Zobacz SECURITY.md §4.',
  'setup.permissions.nonInteractive':
    'Kontynuuję z włączonymi uprawnieniami workera (tryb nieinteraktywny).',
  'setup.permissions.prompt': 'Kontynuować z włączonymi uprawnieniami workera? [Y/n] ',
  'setup.uninstalled': '🗑️ Rejestracja Gelada MCP w klientach została usunięta',
  'setup.completed': '✅ Konfiguracja środowiska Gelada MCP zakończona',
  'setup.configDir': '   Katalog konfiguracji: {path}',
  'setup.dataDir': '   Katalog danych:       {path}',
  'setup.logDir': '   Katalog logów:        {path}',
  'setup.clientUpdates': '   Zmiany u klientów:',
  'setup.notReady': '\nKonfiguracja zakończona, ale delegowanie nie jest jeszcze gotowe:',
  'setup.checkFailed': '   [fail] {name}: {message}',
  'setup.checkFix': '          → {remediation}',
  'setup.fixThenSmoke': '\nPopraw powyższe, a potem uruchom "gelada smoke", aby potwierdzić.',
  'setup.skippedSmoke':
    '\nPominięto kontrolę delegowania. Uruchom "gelada smoke", kiedy będzie potrzebna.',
  'setup.verifying': '\nSprawdzam delegowanie od początku do końca...',
  'setup.opt.client': 'Skonfiguruj tylko wskazanego klienta (claude, codex, antigravity lub all)',
  'setup.opt.uninstall': 'Usuń Geladę z wykrytych konfiguracji klientów MCP',
  'setup.opt.yes': 'Przyjmij „tak” dla pytań (tryb nieinteraktywny)',
  'setup.opt.noSmoke': 'Pomiń pełną kontrolę delegowania',

  'config.language.invalid':
    'Język "{value}" nie jest obsługiwany. Dostępne: {supported}. Gelada użyje angielskiego.',
};
