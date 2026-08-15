import type { MessageKey } from './en.js';

/**
 * Command names, environment variables, file paths and flags are deliberately
 * left untranslated: they are things the reader has to type back.
 */
export const uk: Record<MessageKey, string> = {
  'cli.description':
    'Локальний open-source MCP-сервер, що делегує рутинні задачі з коду локальним агентам-воркерам',
  'cli.cmd.setup':
    'Створити каталог конфігурації Gelada MCP, каталоги даних і файл налаштувань за замовчуванням',
  'cli.cmd.doctor': 'Перевірити, чи готові Gelada, Git і CLI воркера виконувати задачі',
  'cli.cmd.config': 'Переглянути, прочитати або змінити налаштування Gelada MCP',
  'cli.cmd.task': 'Переглянути, застосувати або відкинути делеговані задачі',
  'cli.cmd.taskInspect': 'Показати метадані, статус, дифи або логи делегованої задачі',
  'cli.cmd.taskPatch': 'Застосувати ревізію або patch-файл до активної задачі',
  'cli.cmd.taskDiscard': 'Скасувати запущену задачу, зупинити супервізори та відкинути зміни worktree',
  'cli.cmd.mcp': 'Керування сервером Gelada MCP та його запуск',
  'cli.cmd.mcpServe': 'Запустити сервер Gelada MCP через stdio-транспорт',
  'cli.cmd.cleanup': 'Видалити застарілі артефакти задач згідно з політикою зберігання',
  'cli.cmd.models': 'Показати моделі воркера, доступні для делегування',
  'cli.cmd.update': 'Перевірити наявність нової версії та за бажанням встановити її',
  'cli.cmd.init': 'Створити стартовий .gelada/policy.yaml у поточному репозиторії',
  'cli.cmd.smoke': 'Делегувати пробну задачу повністю і повідомити, чи спрацювало',
  'cli.cmd.debugBundle': 'Зібрати знімок середовища для звіту про помилку',

  'opt.json': 'Вивід у форматі JSON',
  'opt.verbose': 'Показувати подробиці кожної перевірки',

  'cli.bareInvocation':
    'gelada: MCP-сервер запущено без аргументів. Вкажіть у конфігурації клієнта args ["mcp", "serve"].',

  'doctor.title': '=== Діагностика Gelada ===',
  'doctor.node.name': 'Версія Node.js',
  'doctor.node.ok': 'Node.js {version}',
  'doctor.node.tooOld': 'Node.js {version} нижча за потрібну v{required}',
  'doctor.node.platform': 'Платформа: {platform} {release} ({arch})',
  'doctor.node.fix': 'Встановіть Node.js v{required} або новішу.',
  'doctor.git.name': 'Git CLI',
  'doctor.git.missing': 'git не знайдено в PATH',
  'doctor.git.detail': 'Потрібен для ізольованих worktree (git worktree).',
  'doctor.git.fix':
    'Встановіть Git 2.30 або новіший: Gelada ізолює кожну задачу в окремому git worktree.',
  'doctor.config.name': 'Каталог конфігурації',
  'doctor.config.missing': 'Ще не створено: {path}',
  'doctor.config.unwritable': 'Немає доступу на читання/запис: {path}',
  'doctor.config.dirs': 'Каталог конфігурації: {config}',
  'doctor.config.dataDir': 'Каталог даних:        {data}',
  'doctor.config.logDir': 'Каталог логів:        {log}',
  'doctor.config.fixSetup': 'Виконайте "gelada setup", щоб створити конфігурацію.',
  'doctor.config.fixPermissions': 'Виправте права на {path}.',
  'doctor.registration.name': 'Реєстрація у MCP-клієнтах',
  'doctor.registration.unreadable': 'Не вдалося прочитати конфігурації клієнтів: {error}',
  'doctor.registration.none': 'У жодному виявленому MCP-клієнті Gelada не зареєстрована',
  'doctor.registration.noneDetail':
    'Клієнти, налаштовані вручну, і ті, яких Gelada не виявляє, тут не видно.',
  'doctor.registration.noneFix':
    'Виконайте "gelada setup", щоб зареєструвати Gelada у клієнтах на цій машині.',
  'doctor.registration.allBroken':
    'Записана команда запуску більше не існує (клієнтів: {count})',
  'doctor.registration.someBroken':
    '{broken} з {total} реєстрацій вказують на неіснуючу команду',
  'doctor.registration.brokenDetail': '{client}: {command} — не знайдено ({path})',
  'doctor.registration.brokenFix':
    'Виконайте "gelada setup", щоб перезаписати реєстрацію з актуальним шляхом до інтерпретатора.',
  'doctor.registration.okOne': 'Реєстрація в 1 клієнті розв’язується',
  'doctor.registration.okMany': 'Реєстрації у {count} клієнтах розв’язуються',
  'doctor.worker.name': 'CLI воркера',
  'doctor.worker.missing': '{command} не знайдено або не вдалося запустити',
  'doctor.worker.resolvedFrom': 'Визначено через {source}.',
  'doctor.worker.fix':
    'Встановіть Antigravity CLI і додайте його до PATH або вкажіть шлях у AGY_COMMAND.',
  'doctor.auth.name': 'Автентифікація воркера',
  'doctor.auth.ok': 'Доступно моделей: {count}',
  'doctor.auth.unknown': 'Не вдалося отримати список моделей від CLI воркера',
  'doctor.auth.fix':
    'Запустіть "{command}" один раз у терміналі та увійдіть, потім повторіть "gelada doctor".',
  'doctor.details': '       Подробиці:',
  'doctor.status': 'Стан системи: {status}',
  'doctor.statusHint':
    'Виконайте "gelada setup", щоб полагодити конфігурацію, або розберіться з пунктами вище.',
  'doctor.footer': 'Gelada {version} · {runtime} {nodeVersion}',
  'doctor.opt.noWorker': 'Пропустити перевірки CLI воркера',
  'doctor.opt.strict': 'Виходити з ненульовим кодом, якщо хоч одна перевірка не пройдена',

  'update.title': '=== Оновлення Gelada ===',
  'update.current': 'Поточна версія:  v{version}',
  'update.latest': 'Остання версія:  v{version}',
  'update.status': 'Стан:            {status}',
  'update.upToDate': 'Актуальна версія',
  'update.available': 'Доступне оновлення',
  'update.checkFailed': 'Не вдалося перевірити оновлення: {error}',
  'update.currentOnly': 'Поточна версія: v{version}',
  'update.howTo': 'Виконайте `gelada update --install` або оновіться вручну:',
  'update.releaseNotes': 'Опис релізу: {url}',
  'update.starting': 'Оновлення з v{from} до v{to}...',
  'update.viaNpm':
    'Виявлено встановлення через npm. Виконується npm install -g gelada-mcp@latest...',
  'update.npmDone': 'Оновлення через npm завершено.',
  'update.installing': 'Встановлення v{version} до {dir}...',
  'update.done': 'Оновлення завершено. {path} тепер v{version}.',
  'update.failed': 'Оновлення не вдалося: {error}',
  'update.opt.install': 'Встановити останнє оновлення, якщо воно є',

  'setup.permissions.heading': 'Права воркера',
  'setup.permissions.body':
    'Antigravity CLI не може запитувати підтвердження на використання інструментів\n' +
    'у headless-режимі і в ньому ж ігнорує власні правила дозволів. Тому Gelada\n' +
    'запускає його з вимкненими запитами прав — без цього воркер не зможе записати\n' +
    'жодного файлу.\n\n' +
    'Що обмежує його натомість: воркер бачить лише одноразовий git worktree, його\n' +
    'середовище очищене від облікових даних, а команди терміналу виконуються в\n' +
    'пісочниці. Ваше робоче дерево йому недоступне.\n\n' +
    'Це можна вимкнути для окремого проєкту через workerAutoApprove: false у\n' +
    '.gelada/policy.yaml — тоді делегування перестане працювати. Див. SECURITY.md §4.',
  'setup.permissions.nonInteractive':
    'Продовжуємо з увімкненими правами воркера (неінтерактивний режим).',
  'setup.permissions.prompt': 'Продовжити з увімкненими правами воркера? [Y/n] ',
  'setup.uninstalled': '🗑️ Реєстрацію Gelada MCP у клієнтах видалено',
  'setup.completed': '✅ Налаштування середовища Gelada MCP завершено',
  'setup.configDir': '   Каталог конфігурації: {path}',
  'setup.dataDir': '   Каталог даних:        {path}',
  'setup.logDir': '   Каталог логів:        {path}',
  'setup.clientUpdates': '   Зміни в клієнтах:',
  'setup.notReady': '\nНалаштування завершено, але делегування ще не готове:',
  'setup.checkFailed': '   [fail] {name}: {message}',
  'setup.checkFix': '          → {remediation}',
  'setup.fixThenSmoke': '\nВиправте перелічене, потім виконайте "gelada smoke" для перевірки.',
  'setup.skippedSmoke':
    '\nПеревірку делегування пропущено. Виконайте "gelada smoke", коли знадобиться.',
  'setup.verifying': '\nПеревіряємо делегування повністю...',
  'setup.opt.client': 'Налаштувати лише вказаний клієнт (claude, codex, antigravity або all)',
  'setup.opt.uninstall': 'Видалити Gelada з виявлених конфігурацій MCP-клієнтів',
  'setup.opt.yes': 'Відповідати «так» на запитання (неінтерактивний режим)',
  'setup.opt.noSmoke': 'Пропустити наскрізну перевірку делегування',

  'config.language.invalid':
    'Мова "{value}" не підтримується. Доступні: {supported}. Gelada використовує англійську.',
};
