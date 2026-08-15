import type { MessageKey } from './en.js';

/**
 * Command names, environment variables, file paths and flags are deliberately
 * left untranslated: they are things the reader has to type back.
 */
export const ru: Record<MessageKey, string> = {
  'cli.description':
    'Локальный open-source MCP-сервер, делегирующий рутинные задачи по коду локальным агентам-воркерам',
  'cli.cmd.setup':
    'Создать каталог конфигурации Gelada MCP, каталоги данных и файл настроек по умолчанию',
  'cli.cmd.doctor': 'Проверить, готовы ли Gelada, Git и CLI воркера выполнять задачи',
  'cli.cmd.config': 'Просмотреть, прочитать или изменить настройки Gelada MCP',
  'cli.cmd.task': 'Просмотреть, применить или отбросить делегированные задачи',
  'cli.cmd.taskInspect': 'Показать метаданные, статус, диффы или логи делегированной задачи',
  'cli.cmd.taskPatch': 'Применить ревизию или patch-файл к активной задаче',
  'cli.cmd.taskDiscard': 'Отменить выполняющуюся задачу, остановить супервизоры и отбросить изменения worktree',
  'cli.cmd.mcp': 'Управление сервером Gelada MCP и его запуск',
  'cli.cmd.mcpServe': 'Запустить сервер Gelada MCP через stdio-транспорт',
  'cli.cmd.cleanup': 'Удалить устаревшие артефакты задач согласно политике хранения',
  'cli.cmd.models': 'Показать модели воркера, доступные для делегирования',
  'cli.cmd.update': 'Проверить наличие новой версии и при желании установить её',
  'cli.cmd.init': 'Создать стартовый .gelada/policy.yaml в текущем репозитории',
  'cli.cmd.smoke': 'Делегировать пробную задачу целиком и сообщить, сработало ли',
  'cli.cmd.debugBundle': 'Собрать снимок окружения для отчёта об ошибке',

  'opt.json': 'Вывод в формате JSON',
  'opt.verbose': 'Показывать подробности по каждой проверке',

  'cli.bareInvocation':
    'gelada: MCP-сервер запущен без аргументов. Укажите в конфигурации клиента args ["mcp", "serve"].',

  'doctor.title': '=== Диагностика Gelada ===',
  'doctor.node.name': 'Версия Node.js',
  'doctor.node.ok': 'Node.js {version}',
  'doctor.node.tooOld': 'Node.js {version} ниже требуемой v{required}',
  'doctor.node.platform': 'Платформа: {platform} {release} ({arch})',
  'doctor.node.fix': 'Установите Node.js v{required} или новее.',
  'doctor.git.name': 'Git CLI',
  'doctor.git.missing': 'git не найден в PATH',
  'doctor.git.detail': 'Нужен для изолированных worktree (git worktree).',
  'doctor.git.fix':
    'Установите Git 2.30 или новее: Gelada изолирует каждую задачу в отдельном git worktree.',
  'doctor.config.name': 'Каталог конфигурации',
  'doctor.config.missing': 'Ещё не создан: {path}',
  'doctor.config.unwritable': 'Нет доступа на чтение/запись: {path}',
  'doctor.config.dirs': 'Каталог конфигурации: {config}',
  'doctor.config.dataDir': 'Каталог данных:       {data}',
  'doctor.config.logDir': 'Каталог логов:        {log}',
  'doctor.config.fixSetup': 'Выполните "gelada setup", чтобы создать конфигурацию.',
  'doctor.config.fixPermissions': 'Исправьте права на {path}.',
  'doctor.registration.name': 'Регистрация в MCP-клиентах',
  'doctor.registration.unreadable': 'Не удалось прочитать конфигурации клиентов: {error}',
  'doctor.registration.none': 'Ни в одном обнаруженном MCP-клиенте Gelada не зарегистрирована',
  'doctor.registration.noneDetail':
    'Клиенты, настроенные вручную, и те, которых Gelada не обнаруживает, здесь не видны.',
  'doctor.registration.noneFix':
    'Выполните "gelada setup", чтобы зарегистрировать Gelada в клиентах на этой машине.',
  'doctor.registration.allBroken':
    'Записанная команда запуска больше не существует (клиентов: {count})',
  'doctor.registration.someBroken':
    '{broken} из {total} регистраций указывают на несуществующую команду',
  'doctor.registration.brokenDetail': '{client}: {command} — не найдено ({path})',
  'doctor.registration.brokenFix':
    'Выполните "gelada setup", чтобы перезаписать регистрацию с актуальным путём к интерпретатору.',
  'doctor.registration.okOne': 'Регистрация в 1 клиенте разрешается',
  'doctor.registration.okMany': 'Регистрации в {count} клиентах разрешаются',
  'doctor.worker.name': 'CLI воркера',
  'doctor.worker.missing': '{command} не найден или не запустился',
  'doctor.worker.resolvedFrom': 'Определён через {source}.',
  'doctor.worker.fix':
    'Установите Antigravity CLI и добавьте его в PATH либо укажите путь в AGY_COMMAND.',
  'doctor.auth.name': 'Аутентификация воркера',
  'doctor.auth.ok': 'Доступно моделей: {count}',
  'doctor.auth.unknown': 'Не удалось получить список моделей от CLI воркера',
  'doctor.auth.fix':
    'Запустите "{command}" один раз в терминале и войдите, затем повторите "gelada doctor".',
  'doctor.details': '       Подробности:',
  'doctor.status': 'Состояние системы: {status}',
  'doctor.statusHint':
    'Выполните "gelada setup", чтобы починить конфигурацию, либо разберитесь с пунктами выше.',
  'doctor.footer': 'Gelada {version} · {runtime} {nodeVersion}',
  'doctor.opt.noWorker': 'Пропустить проверки CLI воркера',
  'doctor.opt.strict': 'Выходить с ненулевым кодом, если хоть одна проверка не пройдена',

  'update.title': '=== Обновление Gelada ===',
  'update.current': 'Текущая версия:  v{version}',
  'update.latest': 'Последняя версия: v{version}',
  'update.status': 'Состояние:        {status}',
  'update.upToDate': 'Актуальная версия',
  'update.available': 'Доступно обновление',
  'update.checkFailed': 'Не удалось проверить обновления: {error}',
  'update.currentOnly': 'Текущая версия: v{version}',
  'update.howTo': 'Выполните `gelada update --install` либо обновитесь вручную:',
  'update.releaseNotes': 'Описание релиза: {url}',
  'update.starting': 'Обновление с v{from} до v{to}...',
  'update.viaNpm': 'Обнаружена установка через npm. Выполняется npm install -g gelada-mcp@latest...',
  'update.npmDone': 'Обновление через npm завершено.',
  'update.installing': 'Установка v{version} в {dir}...',
  'update.done': 'Обновление завершено. {path} теперь v{version}.',
  'update.failed': 'Обновление не удалось: {error}',
  'update.opt.install': 'Установить последнее обновление, если оно есть',

  'setup.permissions.heading': 'Права воркера',
  'setup.permissions.body':
    'Antigravity CLI не может запрашивать подтверждение на использование инструментов\n' +
    'в headless-режиме и в нём же игнорирует собственные правила разрешений. Поэтому\n' +
    'Gelada запускает его с отключёнными запросами прав — без этого воркер не сможет\n' +
    'записать ни одного файла.\n\n' +
    'Что ограничивает его вместо этого: воркер видит только одноразовый git worktree,\n' +
    'его окружение очищено от учётных данных, а команды терминала выполняются в\n' +
    'песочнице. Ваше рабочее дерево ему недоступно.\n\n' +
    'Это можно отключить для отдельного проекта через workerAutoApprove: false в\n' +
    '.gelada/policy.yaml — тогда делегирование перестанет работать. См. SECURITY.md §4.',
  'setup.permissions.nonInteractive':
    'Продолжаем с включёнными правами воркера (неинтерактивный режим).',
  'setup.permissions.prompt': 'Продолжить с включёнными правами воркера? [Y/n] ',
  'setup.uninstalled': '🗑️ Регистрация Gelada MCP в клиентах удалена',
  'setup.completed': '✅ Настройка окружения Gelada MCP завершена',
  'setup.configDir': '   Каталог конфигурации: {path}',
  'setup.dataDir': '   Каталог данных:       {path}',
  'setup.logDir': '   Каталог логов:        {path}',
  'setup.clientUpdates': '   Изменения в клиентах:',
  'setup.notReady': '\nНастройка завершена, но делегирование ещё не готово:',
  'setup.checkFailed': '   [fail] {name}: {message}',
  'setup.checkFix': '          → {remediation}',
  'setup.fixThenSmoke': '\nИсправьте перечисленное, затем выполните "gelada smoke" для проверки.',
  'setup.skippedSmoke':
    '\nПроверка делегирования пропущена. Выполните "gelada smoke", когда понадобится.',
  'setup.verifying': '\nПроверяем делегирование целиком...',
  'setup.opt.client':
    'Настроить только указанный клиент (claude, codex, antigravity или all)',
  'setup.opt.uninstall': 'Удалить Gelada из обнаруженных конфигураций MCP-клиентов',
  'setup.opt.yes': 'Отвечать «да» на вопросы (неинтерактивный режим)',
  'setup.opt.noSmoke': 'Пропустить сквозную проверку делегирования',

  'settings.empty': '(пусто)',
  'settings.on': 'вкл',
  'settings.off': 'выкл',
  'settings.done': 'Готово',
  'settings.doneHint': 'закрыть редактор',
  'editor.title': 'Настройки Gelada — {path}',
  'editor.footer': '↑/↓ выбор · Enter изменить · q выход',
  'editor.footerEnum': '↑/↓ выбор · Enter применить · q назад',
  'editor.footerText': 'Введите новое значение и нажмите Enter. Пустая строка оставит {current}.',
  'editor.saved': 'Сохранено {key} = {value}',
  'editor.unchanged': 'Ничего не изменилось.',
  'editor.notInteractive':
    'Для интерактивного редактирования gelada config нужен терминал. Используйте "gelada config list" для просмотра или "gelada config set <ключ> <значение>" для изменения.',
  'editor.corrupt': 'Редактирование невозможно: {error}',
  'editor.corruptHint': 'Исправьте файл или выполните "gelada setup --force", чтобы перезаписать его.',
  'settings.ui.language.label': 'Язык интерфейса',
  'settings.ui.language.help': 'Язык самого CLI. На агента не влияет.',
  'settings.ui.language.auto': 'Как в системе',
  'settings.ui.language.en': 'Английский',
  'settings.ui.language.ru': 'Русский',
  'settings.ui.language.uk': 'Украинский',
  'settings.ui.language.pl': 'Польский',
  'settings.worker.command.label': 'Команда воркера',
  'settings.worker.command.help': 'CLI, которому Gelada делегирует. Обычно "agy".',
  'settings.worker.timeout.label': 'Таймаут воркера',
  'settings.worker.timeout.help': 'Через сколько секунд задача снимается (30-7200).',
  'settings.policy.mode.label': 'Режим политики',
  'settings.policy.mode.help': 'Насколько жёстко ограничен воркер.',
  'settings.policy.mode.strict': 'Строгий — только разрешённые команды',
  'settings.policy.mode.permissive': 'Мягкий — всё, кроме запрещённых шаблонов',
  'settings.policy.mode.disabled': 'Отключён — команды не проверяются',
  'settings.policy.allowed.label': 'Разрешённые команды',
  'settings.policy.allowed.help': 'Через запятую. Работает в строгом режиме.',
  'settings.policy.blocked.label': 'Запрещённые шаблоны',
  'settings.policy.blocked.help': 'Через запятую. Не выполняются ни в каком режиме.',
  'settings.logging.level.label': 'Уровень логирования',
  'settings.logging.level.help': 'Сколько Gelada пишет в лог.',
  'settings.logging.level.debug': 'Debug — всё подряд',
  'settings.logging.level.info': 'Info — обычный',
  'settings.logging.level.warn': 'Только предупреждения',
  'settings.logging.level.error': 'Только ошибки',
  'settings.logging.toFile.label': 'Писать файл лога',
  'settings.logging.toFile.help': 'Хранить логи на диске, а не только в stderr.',
  'settings.error.enum': '{key} должен быть одним из: {allowed} (получено "{value}")',
  'settings.error.boolean': '{key} должен быть true или false (получено "{value}")',
  'settings.error.number': '{key} должен быть целым числом (получено "{value}")',
  'settings.error.range': '{key} должен быть в диапазоне от {min} до {max}',

};
