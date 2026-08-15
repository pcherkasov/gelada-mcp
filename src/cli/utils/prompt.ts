import readline from 'node:readline';

/**
 * A minimal arrow-key menu, written rather than depended on.
 *
 * The whole surface is one list and one text field, the standalone binary is
 * already 20 MB, and a prompt library would be the only dependency in the tree
 * that has to survive being bundled by pkg. What it costs instead is this file.
 *
 * Navigation state is kept as plain data and moved by a pure function, so the
 * behaviour is testable without a terminal; only `run` touches stdin.
 */

export interface Choice<T> {
  value: T;
  label: string;
  /** Shown dimmed after the label — the current value, a unit, a warning. */
  hint?: string;
}

export interface MenuState {
  index: number;
  count: number;
  done: boolean;
  cancelled: boolean;
}

export type Key = 'up' | 'down' | 'home' | 'end' | 'submit' | 'cancel' | 'other';

/** Maps a readline keypress to the only six things this menu understands. */
export function classifyKey(
  str: string | undefined,
  key: { name?: string; ctrl?: boolean } | undefined,
): Key {
  if (key?.ctrl && (key.name === 'c' || key.name === 'd')) return 'cancel';
  switch (key?.name) {
    case 'up':
    case 'k':
      return 'up';
    case 'down':
    case 'j':
      return 'down';
    case 'home':
      return 'home';
    case 'end':
      return 'end';
    case 'return':
    case 'enter':
    case 'space':
      return 'submit';
    case 'escape':
    case 'q':
      return 'cancel';
    default:
      return str === '\r' || str === '\n' ? 'submit' : 'other';
  }
}

/**
 * Moves the cursor. Wraps at both ends, because a menu that stops dead at the
 * bottom makes the last item the hardest one to reach.
 */
export function applyKey(state: MenuState, key: Key): MenuState {
  if (state.count === 0) return { ...state, done: true, cancelled: true };
  switch (key) {
    case 'up':
      return { ...state, index: (state.index - 1 + state.count) % state.count };
    case 'down':
      return { ...state, index: (state.index + 1) % state.count };
    case 'home':
      return { ...state, index: 0 };
    case 'end':
      return { ...state, index: state.count - 1 };
    case 'submit':
      return { ...state, done: true };
    case 'cancel':
      return { ...state, done: true, cancelled: true };
    default:
      return state;
  }
}

const useColour = !process.env.NO_COLOR && process.stdout.isTTY;
const dim = (s: string) => (useColour ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (useColour ? `\x1b[1m${s}\x1b[0m` : s);
const invert = (s: string) => (useColour ? `\x1b[7m${s}\x1b[0m` : s);

/** Renders the menu as lines. Pure, so a test can read what a user would see. */
export function renderMenu<T>(
  title: string,
  choices: Choice<T>[],
  state: MenuState,
  footer: string,
): string[] {
  const width = Math.max(20, (process.stdout.columns || 80) - 1);
  const truncate = (s: string) => (s.length > width ? `${s.slice(0, width - 1)}…` : s);

  // Pad to a common width so the hints form a column; the highlight on the
  // selected row must not be what decides where the second column starts.
  const labelWidth = Math.max(...choices.map((c) => c.label.length), 0);

  const lines = [bold(title), ''];
  choices.forEach((choice, i) => {
    const selected = i === state.index;
    const padded = choice.label.padEnd(labelWidth);
    const marker = selected ? '❯ ' : '  ';
    const label = selected ? invert(` ${padded} `) : ` ${padded} `;
    const hint = choice.hint ? `  ${dim(choice.hint)}` : '';
    lines.push(truncate(`${marker}${label}${hint}`));
  });
  lines.push('', dim(footer));
  return lines;
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export class NotInteractiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotInteractiveError';
  }
}

/**
 * Shows the menu and resolves with the chosen value, or undefined if cancelled.
 *
 * Throws rather than hanging when there is no terminal: a pipe cannot answer,
 * and blocking forever on stdin is the failure this CLI already made once.
 */
export async function select<T>(options: {
  title: string;
  choices: Choice<T>[];
  footer: string;
  initialIndex?: number;
}): Promise<T | undefined> {
  if (!isInteractive()) {
    throw new NotInteractiveError('select() requires a terminal');
  }

  const { title, choices, footer } = options;
  let state: MenuState = {
    index: Math.min(Math.max(options.initialIndex ?? 0, 0), Math.max(choices.length - 1, 0)),
    count: choices.length,
    done: false,
    cancelled: false,
  };

  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  let painted = 0;
  const paint = () => {
    if (painted > 0) {
      readline.moveCursor(process.stdout, 0, -painted);
      readline.clearScreenDown(process.stdout);
    }
    const lines = renderMenu(title, choices, state, footer);
    process.stdout.write(`${lines.join('\n')}\n`);
    painted = lines.length;
  };

  process.stdout.write('\x1b[?25l'); // hide the cursor; the marker is the cursor
  paint();

  try {
    return await new Promise<T | undefined>((resolve) => {
      const onKeypress = (str: string | undefined, key: { name?: string; ctrl?: boolean }) => {
        state = applyKey(state, classifyKey(str, key));
        if (!state.done) {
          paint();
          return;
        }
        process.stdin.off('keypress', onKeypress);
        resolve(state.cancelled ? undefined : choices[state.index]?.value);
      };
      process.stdin.on('keypress', onKeypress);
    });
  } finally {
    process.stdout.write('\x1b[?25h'); // show the cursor again
    if (painted > 0) {
      readline.moveCursor(process.stdout, 0, -painted);
      readline.clearScreenDown(process.stdout);
    }
    process.stdin.setRawMode(Boolean(wasRaw));
    process.stdin.pause();
  }
}

/** Reads one line, offering `current` as the value to keep. */
export async function text(options: {
  title: string;
  current: string;
  footer: string;
}): Promise<string | undefined> {
  if (!isInteractive()) {
    throw new NotInteractiveError('text() requires a terminal');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`${bold(options.title)}\n${dim(options.footer)}\n`);
    const answer: string = await new Promise((resolve) => rl.question('❯ ', resolve));
    const trimmed = answer.trim();
    return trimmed === '' ? options.current : trimmed;
  } finally {
    rl.close();
  }
}
