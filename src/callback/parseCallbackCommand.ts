export type ParsedCommand = { ok: true; argv: string[] } | { ok: false; reason: string };

/**
 * A `--callback` value split on whitespace into argv — spawned directly, never
 * through a shell, so quoting and pipes have no meaning here and are refused
 * by construction rather than misread.
 */
export function parseCallbackCommand(command: string): ParsedCommand {
  const trimmed = command.trim();
  if (trimmed === "") {
    return { ok: false, reason: "--callback needs a command" };
  }
  const argv = trimmed.split(/\s+/);
  if (argv[0].startsWith("-")) {
    return { ok: false, reason: `--callback command cannot start with '-': ${argv[0]}` };
  }
  return { ok: true, argv };
}
