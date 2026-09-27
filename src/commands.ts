/**
 * Every command the CLI accepts and the flags each one reads.
 *
 * The CLI dispatches from this table, and a command that reads a flag not
 * listed for it fails to typecheck. The CLI surface test requires a case for
 * every entry.
 */
export const COMMANDS = {
  build: ['commit', 'out'],
  check: ['commit'],
} as const;

export type Command = keyof typeof COMMANDS;

/** Reads the value of one of a command's declared flags. */
export type FlagReader<C extends Command> = (name: (typeof COMMANDS)[C][number]) => string | undefined;

export function isCommand(name: string): name is Command {
  return Object.hasOwn(COMMANDS, name);
}
