/**
 * Approval policy — C3. What may an unattended run do without asking?
 *
 * The mechanism (canUseTool interception) has existed all along; this supplies
 * the missing POLICY. It replaces a hardcoded ten-name tool list with a
 * classifier, because MCP tools have arbitrary names and a fixed list is wrong
 * the day a new connector is added.
 *
 * The classification question is narrow: does this call have side effects on
 * the world OUTSIDE the app? Reading is free. Acting inside the app (creating a
 * card, scheduling a reminder, asking the user) is visible in the UI and
 * reversible there, so it is not gated. Sending, deleting, publishing, paying,
 * writing files and running arbitrary shell commands are the calls a human
 * would want to see before an unattended agent makes them.
 *
 * Pure and heavily tested — this is a security-relevant classifier, so unknown
 * inputs FAIL CLOSED under a gating policy.
 */
import type { ApprovalPolicy } from './types';

export type ToolClass =
  /** Reads state, nothing changes: Read, Grep, list/get/search MCP tools. */
  | 'read'
  /** Acts inside the app; visible and reversible in the UI. */
  | 'app'
  /** Side effects on the world outside the app. */
  | 'consequential'
  /** Cannot tell. Treated as consequential under a gating policy. */
  | 'unknown';

/** Exact-name classes for the built-in toolset. */
const BUILTIN: Record<string, ToolClass> = {
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  WebSearch: 'read',
  WebFetch: 'read',
  TodoWrite: 'app',
  Task: 'app',
  Skill: 'app',
  AskUserQuestion: 'app',
  canvas: 'app',
  spawn_agent: 'app',
  CronCreate: 'app',
  StandingOrderCreate: 'app',
  NotebookEdit: 'consequential',
  Write: 'consequential',
  Edit: 'consequential',
  // Bash is classified by its command, not its name — see classifyBash.
};

/** Verb prefixes that read. Matched against the tool name's last segment. */
const READ_VERBS = /^(get|list|read|search|fetch|find|query|describe|view|show|check|lookup|count|watch)([_-]|$)/i;

/**
 * Verb prefixes that act on the world. Includes payments and bookings — the
 * expensive mistakes — ahead of the obvious create/send/delete family.
 */
const CONSEQUENTIAL_VERBS =
  /^(send|post|create|update|delete|remove|publish|deploy|write|edit|replace|upload|merge|submit|pay|purchase|buy|book|order|cancel|approve|reject|archive|move|rename|set|add|invite|schedule|reply|forward|transfer|execute|run|trigger|kill|restart|stop|start|apply|patch|push|revoke|grant|assign|close|reopen|label|comment)([_-]|$)/i;

/**
 * Segments that join two operations into one tool name: `findAndReplace`,
 * `getOrCreateChannel`. Their presence means the leading verb describes only
 * HALF of what the tool does, so the other half has to be judged too.
 */
const CONJUNCTIONS = /^(and|or|then)$/i;

/** The tool's own name with any MCP server prefix stripped. */
export function baseToolName(toolName: string): string {
  if (toolName.includes('__')) return toolName.split('__').pop()!;
  if (toolName.includes(':')) return toolName.split(':').pop()!;
  return toolName;
}

/**
 * Insert a separator at camelCase boundaries so the verb regexes see a first
 * segment they can match.
 *
 * Both verb lists anchor on `([_-]|$)`, which meant a camelCase name never
 * matched: `getIssue` fell through to 'unknown'. Since real MCP servers name
 * tools in camelCase — Atlassian ships `searchJiraIssuesUsingJql` and
 * `transitionJiraIssue` — that made the classifier blind to the majority of tool
 * names it exists to classify. Reads were gated as unknowns (so unattended runs
 * paused on ordinary lookups) and genuine write verbs were only caught by the
 * fail-closed default rather than being recognised for what they are.
 *
 * A boundary is a lower-case letter or digit followed by an upper-case one, so
 * acronyms survive: `getURLData` → `get_URLData`, whose first segment is `get`.
 */
export function splitCamelCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
}

// ── Bash ──────────────────────────────────────────────────────────────────

/**
 * Why a binary is trusted — stated per binary, not implied by membership.
 *
 * The previous shape was a bare `Set` of names, which encoded only "someone
 * thought this was read-only" and could not express the difference between `cat`
 * (nothing it can be told to do writes) and `find` (writes and executes the
 * moment you pass `-exec` or `-delete`). Every entry now has to declare which
 * of the two it is, so adding a binary forces the question "what are its
 * dangerous flags?" to be answered in the table rather than discovered in
 * production.
 */
export type BinaryRule =
  /** Nothing in its argument language writes, deletes or executes. */
  | { kind: 'reader'; why: string }
  /**
   * A genuine reader with a bounded set of escapes: `forbidden` flags, and/or a
   * cap on positional operands for the binaries that take an OUTPUT FILE as an
   * operand rather than behind a flag.
   */
  | { kind: 'guarded'; why: string; forbidden: readonly string[]; maxOperands?: number };

/**
 * Binaries trusted to only read, and the terms on which each is trusted.
 *
 * The rule for admission is narrow: a binary belongs here only if the set of
 * ways it can write, delete or execute is ENUMERABLE. If its argument is an
 * unbounded program — `awk`, `env`, a shell — no flag guard can be trusted and
 * it belongs in EXCLUDED_BINARIES instead.
 */
export const READ_ONLY_BINARIES: Readonly<Record<string, BinaryRule>> = {
  // ── Pure readers: no argument makes them write ────────────────────────
  ls: { kind: 'reader', why: 'Lists directory entries; it has no flag that writes anything.' },
  cat: { kind: 'reader', why: 'Concatenates to stdout only; writing needs a shell redirect, which is guarded globally.' },
  head: { kind: 'reader', why: 'Prints leading bytes/lines to stdout; it has no output-file flag.' },
  tail: { kind: 'reader', why: 'Prints trailing bytes/lines to stdout; -f only follows, it does not write.' },
  grep: { kind: 'reader', why: 'Matches to stdout. -f reads a pattern file; nothing in grep writes or runs a program.' },
  egrep: { kind: 'reader', why: 'Alias for grep -E; same reasoning as grep — no write and no exec flag.' },
  fgrep: { kind: 'reader', why: 'Alias for grep -F; same reasoning as grep — no write and no exec flag.' },
  wc: { kind: 'reader', why: 'Counts and prints to stdout; it accepts no output destination.' },
  cut: { kind: 'reader', why: 'Selects fields to stdout. --output-delimiter names a STRING, not a file, so it is not an escape.' },
  tr: { kind: 'reader', why: 'Transforms a stream to stdout; it cannot open a file at all, only stdin.' },
  diff: { kind: 'reader', why: 'Compares files to stdout; every flag selects a report format, none writes a patch to disk.' },
  file: { kind: 'reader', why: 'Reports file types. -f and -m READ a names/magic file; neither writes.' },
  stat: { kind: 'reader', why: 'Prints inode metadata; it has no mutating mode.' },
  pwd: { kind: 'reader', why: 'Prints the working directory and accepts nothing that could write.' },
  whoami: { kind: 'reader', why: 'Prints the effective user name; it takes no operands at all.' },
  id: { kind: 'reader', why: 'Prints identity for the current or a named user; naming a user is a read.' },
  uname: { kind: 'reader', why: 'Prints kernel/system strings; unlike hostname it has no set form.' },
  printenv: { kind: 'reader', why: 'Prints the environment. Unlike env it cannot run a command — that is why env is excluded and this is not.' },
  which: { kind: 'reader', why: 'Resolves a name against PATH and prints it; it never executes what it finds.' },
  type: { kind: 'reader', why: 'Shell builtin that reports how a name would resolve; it does not run it.' },
  echo: { kind: 'reader', why: 'Writes its arguments to stdout only; reaching a file needs a guarded redirect.' },
  printf: { kind: 'reader', why: 'Formats to stdout only; unlike awk it has no file or pipe output target.' },
  basename: { kind: 'reader', why: 'Pure string manipulation of a path; it does not touch the filesystem.' },
  dirname: { kind: 'reader', why: 'Pure string manipulation of a path; it does not touch the filesystem.' },
  realpath: { kind: 'reader', why: 'Resolves a path and prints it; resolution is a read of the directory tree.' },
  du: { kind: 'reader', why: 'Sums disk usage to stdout; it has no output-file or exec flag.' },
  df: { kind: 'reader', why: 'Reports filesystem capacity to stdout; it cannot mount or modify anything.' },
  ps: { kind: 'reader', why: 'Snapshots the process table; it cannot signal or kill a process.' },
  top: { kind: 'reader', why: 'Reports process state. Its config write is an interactive keystroke, not an argument.' },
  uptime: { kind: 'reader', why: 'Prints load averages; it accepts no operands that could write.' },
  md5: { kind: 'reader', why: 'Hashes files or a -s string to stdout; it has no output-file flag.' },
  md5sum: { kind: 'reader', why: 'Hashes to stdout. -c READS a checksum file to verify against; it writes nothing.' },
  shasum: { kind: 'reader', why: 'Hashes to stdout. -c READS a checksum file to verify against; it writes nothing.' },
  sha256sum: { kind: 'reader', why: 'Hashes to stdout. -c READS a checksum file to verify against; it writes nothing.' },
  column: { kind: 'reader', why: 'Formats a stream into columns on stdout; it has no file output.' },
  nl: { kind: 'reader', why: 'Numbers lines to stdout; unlike uniq it takes no output operand.' },
  od: { kind: 'reader', why: 'Dumps bytes to stdout; unlike xxd it has no output operand and no reverse mode.' },
  strings: { kind: 'reader', why: 'Extracts printable runs to stdout; -f only prefixes the file name.' },

  // ── Guarded readers: real readers with enumerable escapes ─────────────
  find: {
    kind: 'guarded',
    why: 'Walks the tree (a read) but its predicate language runs commands and deletes/writes paths.',
    forbidden: ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls'],
  },
  fd: {
    kind: 'guarded',
    why: "find's modern replacement, with the same exec escape under different flag names.",
    forbidden: ['-x', '--exec', '-X', '--exec-batch'],
  },
  rg: {
    kind: 'guarded',
    why: 'Searches like grep, but --pre runs an arbitrary preprocessor command on every file it visits.',
    forbidden: ['--pre', '--hostname-bin'],
  },
  sed: {
    kind: 'guarded',
    why: 'Stream editing is a read, but -i rewrites in place and -f loads an unbounded script file. Its SCRIPT is checked separately — see sedScriptWritesOrExecutes.',
    forbidden: ['-i', '--in-place', '-f', '--file'],
  },
  sort: {
    kind: 'guarded',
    why: 'Sorts to stdout, except -o which writes a file and --compress-program which runs an arbitrary binary.',
    forbidden: ['-o', '--output', '--compress-program'],
  },
  uniq: {
    kind: 'guarded',
    why: 'Filters duplicates, but POSIX uniq takes [INPUT [OUTPUT]] — its write is a positional operand, not a flag, so operands are capped instead.',
    forbidden: [],
    maxOperands: 1,
  },
  jq: {
    kind: 'guarded',
    why: 'Its expression language has no write or exec builtin, so only an in-place flag could make it write.',
    forbidden: ['-i', '--in-place'],
  },
  yq: {
    kind: 'guarded',
    why: 'Like jq, but -i rewrites the document in place and --split-exp fans output out into files.',
    forbidden: ['-i', '--inplace', '--in-place', '-s', '--split-exp'],
  },
  tree: {
    kind: 'guarded',
    why: 'Prints a directory listing, except -o which sends that listing to a file.',
    forbidden: ['-o', '--output'],
  },
  xxd: {
    kind: 'guarded',
    why: 'Hex-dumps to stdout, but takes [INFILE [OUTFILE]] — with -r that positional write reconstitutes an arbitrary binary.',
    forbidden: [],
    maxOperands: 1,
  },
  hostname: {
    kind: 'guarded',
    why: 'Prints the host name, but a bare operand SETS it — a system mutation, and unattended runs in containers are often root.',
    forbidden: [],
    maxOperands: 0,
  },
  date: {
    kind: 'guarded',
    why: 'Prints time, but -s sets the system clock and BSD date sets it from a bare operand too, so only +FORMAT operands are allowed.',
    forbidden: ['-s', '--set'],
    maxOperands: 0,
  },
};

/**
 * Binaries deliberately NOT trusted, and why. This is the record of the
 * fail-closed decision: a name here can never be re-added to the table above
 * without the disjointness test failing, so the "trusted because the name looks
 * harmless" bug cannot quietly return.
 *
 * The common thread is that the dangerous input is not a flag but the program
 * text or command name itself, so there is nothing bounded to guard.
 */
export const EXCLUDED_BINARIES: Readonly<Record<string, string>> = {
  env: 'Runs an arbitrary command passed as a positional operand: `env rm -rf ~`. printenv covers the legitimate read.',
  awk: 'Unbounded program text with system(), `print > "file"` and pipes into a shell. No flag guard can bound it.',
  less: 'Pager with a documented `!cmd` shell escape and LESSOPEN/LESSCLOSE preprocessor hooks; also useless without a tty.',
  more: 'Pager with the same `!cmd` shell escape as less, and no value in an unattended run.',
  tee: 'Its entire purpose is writing its operands, which are arbitrary paths.',
  xargs: 'Executes a command per input line — the command is an operand, so the escape cannot be flag-guarded.',
  perl: 'A general-purpose interpreter; -e takes unbounded program text that can write, exec and open sockets.',
  python: 'A general-purpose interpreter; -c takes unbounded program text with full filesystem and process access.',
  python3: 'A general-purpose interpreter; -c takes unbounded program text with full filesystem and process access.',
  ruby: 'A general-purpose interpreter; -e takes unbounded program text with full filesystem and process access.',
  node: 'A general-purpose interpreter; -e takes unbounded program text with full filesystem and process access.',
  sh: 'A shell: its argument is arbitrary code, which is the thing this classifier exists to gate.',
  bash: 'A shell: its argument is arbitrary code, which is the thing this classifier exists to gate.',
  zsh: 'A shell: its argument is arbitrary code, which is the thing this classifier exists to gate.',
  dash: 'A shell: its argument is arbitrary code, which is the thing this classifier exists to gate.',
  ksh: 'A shell: its argument is arbitrary code, which is the thing this classifier exists to gate.',
  fish: 'A shell: its argument is arbitrary code, which is the thing this classifier exists to gate.',
  vim: 'An editor scriptable with -c/+cmd, including :w to any path and :! to a shell.',
  vi: 'An editor scriptable with -c/+cmd, including :w to any path and :! to a shell.',
  view: 'vim in read-only mode by convention only; -c/+cmd still writes with :w! and shells out with :!.',
  ex: 'The line-editor mode of vi, driven entirely by an unbounded command script that writes and shells out.',
  emacs: '--eval takes unbounded Elisp with full filesystem and subprocess access.',
  nano: 'An interactive editor whose whole purpose is writing the file it is given.',
  nc: 'Opens arbitrary sockets and, with -e on several builds, executes a program on connect — exfiltration and shell in one.',
  netcat: 'Opens arbitrary sockets and, with -e on several builds, executes a program on connect — exfiltration and shell in one.',
  ssh: 'Runs an arbitrary command on a remote host, given as a positional operand; the side effects are off-machine.',
  docker: 'Its subcommands run containers with host mounts, which is arbitrary code with arbitrary filesystem access.',
  make: 'Executes recipes from an unbounded Makefile, and -f points at any file it likes.',
  curl: 'Uploads with -T/-d and writes responses with -o/-O; it is a network write tool, not a reader.',
  wget: 'Writes every fetched response to disk by default, at a path it derives itself.',
  rsync: 'Copies over and deletes files at both ends, and -e names a remote shell to execute.',
  dd: 'Writes raw blocks to of=, up to and including a whole block device.',
  git: 'Not excluded outright but not a plain binary either — it is governed per subcommand by GIT_READ_SUBCOMMANDS.',
};

/**
 * git subcommands that only read, on the same terms as the binaries above.
 *
 * A flat allowlist of subcommand NAMES had exactly the bug this file is fixing
 * one level down: `branch`, `tag`, `remote` and `reflog` are read-only when
 * invoked bare and destructive as soon as they are given an operand or a delete
 * flag, so `git branch -D main` and `git tag -d v1` classified as reads. They
 * are capped at zero operands: listing is a read, naming a ref is a write.
 */
export const GIT_READ_SUBCOMMANDS: Readonly<Record<string, BinaryRule>> = {
  status: { kind: 'reader', why: 'Reports worktree state; no form of it changes a tracked file.' },
  log: {
    kind: 'guarded',
    why: 'Reads history, but it accepts the diff options — including --output, which writes the diff to a file.',
    forbidden: ['--output'],
  },
  diff: {
    kind: 'guarded',
    why: 'Reads a comparison, but --output writes it to an arbitrary path.',
    forbidden: ['--output'],
  },
  show: {
    kind: 'guarded',
    why: 'Reads an object, but it takes the diff options too, so --output can write to disk.',
    forbidden: ['--output'],
  },
  blame: { kind: 'reader', why: 'Annotates lines with their last revision; it has no write form.' },
  describe: { kind: 'reader', why: 'Derives a name for a commit and prints it; it creates no ref.' },
  'rev-parse': { kind: 'reader', why: 'Resolves revision syntax to a hash; pure interrogation of the object store.' },
  'ls-files': { kind: 'reader', why: 'Lists index contents; it cannot stage or remove entries.' },
  'ls-remote': { kind: 'reader', why: 'Lists refs on a remote — a network read that changes nothing locally or remotely.' },
  shortlog: { kind: 'reader', why: 'Summarises log output by author; it writes nothing.' },
  branch: {
    kind: 'guarded',
    why: 'Bare it LISTS branches, but a single operand creates one and -d/-D/-m destroy or rename refs.',
    forbidden: ['-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy', '-f', '--force',
      '--set-upstream-to', '--unset-upstream', '--edit-description', '-u', '-t', '--track'],
    maxOperands: 0,
  },
  tag: {
    kind: 'guarded',
    why: 'Bare it LISTS tags, but a single operand creates a tag and -d deletes one.',
    forbidden: ['-d', '--delete', '-a', '--annotate', '-s', '--sign', '-f', '--force', '-m', '--message',
      '-F', '--file', '-e', '--edit', '--create-reflog'],
    maxOperands: 0,
  },
  remote: {
    kind: 'guarded',
    why: 'Bare it LISTS remotes, but its sub-subcommands (add, remove, set-url, prune) arrive as operands and rewrite config.',
    forbidden: ['--add'],
    maxOperands: 0,
  },
  reflog: {
    kind: 'guarded',
    why: 'Bare it SHOWS the reflog, but `expire` and `delete` arrive as operands and destroy recovery history.',
    forbidden: [],
    maxOperands: 0,
  },
};

/**
 * Look a name up without inheriting from Object.prototype. A plain
 * `table[name]` returns a function for `constructor`, `toString` and friends,
 * which would then be treated as a rule — so a command named `constructor`
 * would sail through, and the guard would throw on `rule.forbidden`.
 */
function ruleFor(table: Readonly<Record<string, BinaryRule>>, name: string): BinaryRule | undefined {
  return Object.hasOwn(table, name) ? table[name] : undefined;
}

/**
 * An operand is a word that is not a flag. `+` counts as a flag marker because
 * `date +%Y` is a format, not the clock-setting operand that `date` caps.
 */
function isOperand(word: string): boolean {
  return !word.startsWith('-') && !word.startsWith('+');
}

/** Does this argv breach the terms on which the binary is trusted? */
function violatesRule(rule: BinaryRule, args: readonly string[]): boolean {
  if (rule.kind === 'reader') return false;

  // Short flags cluster: `sort -uo out.txt` is `-u -o out.txt`, and GNU allows
  // the value to be glued on (`sed -i.bak`). So for a single-dash word, every
  // letter in its leading run counts as a flag in its own right.
  const shorts = new Set(rule.forbidden.filter((f) => /^-[A-Za-z0-9]$/.test(f)).map((f) => f[1]));

  let operands = 0;
  for (const word of args) {
    if (isOperand(word)) {
      operands++;
      continue;
    }
    // `--output=/tmp/x` and `--in-place=bak` name the same flag as their bare form.
    if (rule.forbidden.includes(word.split('=')[0])) return true;
    if (shorts.size && !word.startsWith('--')) {
      const cluster = /^-([A-Za-z0-9]+)/.exec(word)?.[1] ?? '';
      for (const ch of cluster) if (shorts.has(ch)) return true;
    }
  }
  return rule.maxOperands !== undefined && operands > rule.maxOperands;
}

/**
 * sed's script is program text, and GNU sed's script language both writes and
 * executes — `w file` and `s///w file` write, `e cmd` and `s///e` run a shell
 * command — none of which involves a flag. By the admission rule above that
 * would exclude sed outright, but `| sed 's/a/b/'` is too common in read-only
 * pipelines to give up, so sed is trusted only while its script is free of
 * those commands.
 *
 * The dangerous letters occur in two positions, hence two matchers:
 *  - as a COMMAND — at the start of the script or after `;` `{` `}` `,`, a
 *    numeric or `$` address, a `/regex/`, or a quote: `sed 'w out'`, `sed '1e cmd'`.
 *  - as a FLAG on a substitution, after its closing delimiter: `s/a/b/gw out`,
 *    `s/a/b/e`.
 * Both over-match — a replacement text of ` w ` prompts — because words are not
 * dequoted and that is the direction to be wrong in.
 */
const SED_WRITE_OR_EXEC_COMMAND = /(?:^|[;{},$/\s'"0-9])\s*!?\s*[wWe](?:\s|$)/;
const SED_SUBSTITUTION_FLAGS = /(?:^|[;{}\s!='"])[sy](.)(?:\\.|(?!\1)[\s\S])*?\1(?:\\.|(?!\1)[\s\S])*?\1([A-Za-z0-9]*)/g;

function sedScriptWritesOrExecutes(args: readonly string[]): boolean {
  for (const arg of args) {
    if (SED_WRITE_OR_EXEC_COMMAND.test(arg)) return true;
    for (const match of arg.matchAll(SED_SUBSTITUTION_FLAGS)) {
      if (/[we]/.test(match[2] ?? '')) return true;
    }
  }
  return false;
}

/**
 * Where one command ends and the next begins.
 *
 * Every control operator a POSIX shell (and bash) honours is built purely from
 * these characters — `;` `;;` `|` `||` `&` `&&` `|&` — plus the newline, which
 * separates commands just as surely as `;` does. One character class therefore
 * covers the lot, and the `+` collapses runs so `&&` is a single separator
 * rather than two with an empty segment wedged between them. `\r` is included
 * so a command authored on Windows (`\r\n`) does not arrive as one long line.
 *
 * The previous list — `/\|\||&&|;|\|/` — omitted the single `&` and the newline,
 * so `ls & rm -rf ~` and `ls\nrm -rf ~` were one "command" whose first word was
 * `ls`: classified 'read', and 'read' is ungated under EVERY policy.
 */
const SEGMENT_SEPARATORS = /[;|&\n\r]+/;

/**
 * Where one word ends and the next begins — the shell's blanks, space and tab,
 * and deliberately NOT JS `\s`. `\s` matches the newline (so a second command
 * hid behind words[0] once the segment split missed it) and also `\v`, `\f` and
 * NBSP, which the shell lexer treats as ordinary word characters. Splitting on
 * horizontal whitespace only means an unrecognised word stays unrecognised
 * instead of being read as a known-safe binary.
 */
const WORD_SEPARATORS = /[ \t]+/;

/** Leading environment assignment: `FOO=bar cmd …`. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Environment assignments that cannot redirect execution.
 *
 * Assignment words used to be STRIPPED and the following word trusted, so
 * `PATH=/tmp/evil ls` and `LESSOPEN='|sh -c "rm -rf ~"' cat f` classified as
 * reads: the binary was on the allowlist, but the variable decided which program
 * that name actually resolved to, or handed a helper a script to run.
 *
 * A denylist (PATH, LD_PRELOAD, DYLD_*, BASH_ENV, GIT_*, PAGER, PERL5OPT,
 * NODE_OPTIONS, IFS, …) would be wrong the first time a program grows a new hook
 * variable, so this is an ALLOWLIST: locale, timezone and colour settings, which
 * change how output is formatted and nothing else. Anything else is
 * consequential — including harmless application config, which is the accepted
 * cost.
 */
const SAFE_ENV_ASSIGNMENT =
  /^(LC_[A-Z_]+|LANG|LANGUAGE|TZ|COLUMNS|LINES|NO_COLOR|CLICOLOR|CLICOLOR_FORCE|FORCE_COLOR)=/;

/**
 * Classify a shell command. Deliberately conservative: a command is 'read' only
 * when the command contains no redirection or substitution AND every pipeline
 * segment both starts with a known read-only binary and stays within the terms
 * on which that binary is trusted. Everything else — including anything we can't
 * parse — is consequential, because Bash is arbitrary code execution and a
 * misclassified `rm` is unrecoverable while a misclassified `ls` merely asks for
 * an approval it didn't need.
 *
 * The name of the binary is NOT sufficient on its own, which is the mistake this
 * used to make: `find`, `sed`, `sort`, `yq` and friends are readers until an
 * argument tells them otherwise, and `env` and `awk` are not readers at all.
 * See READ_ONLY_BINARIES for the per-binary terms and EXCLUDED_BINARIES for the
 * names deliberately refused.
 *
 * Constructs we don't parse rather than allow: subshells and groups (`(…)`,
 * `{…;}`) keep their bracket attached to the first word, so they never match a
 * read-only binary; a backslash line continuation leaves an argument list as
 * its own segment, which likewise doesn't. Both land on 'consequential', which
 * is the direction to be wrong in.
 */
export function classifyBash(command: unknown): ToolClass {
  if (typeof command !== 'string' || !command.trim()) return 'unknown';
  const text = command.trim();

  // Redirection or substitution ⇒ side effects (or the ability to smuggle them).
  // `>` also catches `>>`. A TRAILING `&` backgrounds the last command, which
  // then outlives the turn with nothing watching it — consequential regardless
  // of what it runs. An `&` anywhere else is a separator (see above), so both
  // halves get classified on their own merits.
  if (/[><]|\$\(|`|&\s*$/.test(text)) return 'consequential';

  // Every segment of a pipeline / command list must independently read.
  const segments = text.split(SEGMENT_SEPARATORS).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return 'unknown';

  for (const segment of segments) {
    const words = segment.split(WORD_SEPARATORS).filter(Boolean);

    // Leading env assignments (FOO=bar cmd …) are consumed, not stripped: one
    // that can redirect execution disqualifies the whole segment.
    let i = 0;
    while (i < words.length && ENV_ASSIGNMENT.test(words[i])) {
      if (!SAFE_ENV_ASSIGNMENT.test(words[i])) return 'consequential';
      i++;
    }

    const bin = words[i]?.toLowerCase();
    if (!bin) return 'consequential';
    const args = words.slice(i + 1);

    if (bin === 'git') {
      const sub = args[0]?.toLowerCase();
      const rule = sub ? ruleFor(GIT_READ_SUBCOMMANDS, sub) : undefined;
      if (!rule || violatesRule(rule, args.slice(1))) return 'consequential';
      continue;
    }

    const rule = ruleFor(READ_ONLY_BINARIES, bin);
    if (!rule || violatesRule(rule, args)) return 'consequential';
    if (bin === 'sed' && sedScriptWritesOrExecutes(args)) return 'consequential';
  }
  return 'read';
}

// ── Classification ────────────────────────────────────────────────────────

export function classifyToolCall(toolName: string, input?: Record<string, unknown>): ToolClass {
  const name = baseToolName(toolName);

  if (name === 'Bash') return classifyBash(input?.command);

  const exact = BUILTIN[name];
  if (exact) return exact;

  // Browser inspection tools read the page; browser interaction acts on it,
  // but only inside the app's own browser surface — 'app' either way.
  if (name.startsWith('browser_')) return 'app';

  // Verb matching runs against a camelCase-split form so `getIssue` is read the
  // same way `get_issue` is — see splitCamelCase. Not filtered for empties: a
  // leading separator (`_getThing`) must keep failing to match a read verb.
  const segments = splitCamelCase(name).split(/[_-]+/);

  // A consequential verb in ANY segment outranks a read verb in the first one.
  // Testing only the leading segment meant `findAndReplace`,
  // `checkAndSendInvoice` and `getOrCreateChannel` all classified 'read' — and
  // 'read' is not gated by any policy, while tool-policy.ts turns it into
  // `always_allow` and pushes it into the SDK, where canUseTool never sees the
  // call at all. The read verb describes half the tool; the other half acts.
  if (segments.some((s) => CONSEQUENTIAL_VERBS.test(s))) return 'consequential';

  if (READ_VERBS.test(segments[0])) {
    // A conjunction promises a second operation. If we can't see that it also
    // only reads, we don't get to call the whole name a read: `findAndReplace`
    // is caught above, but `findAndFrobnicate` is an unknown, not a find.
    const conjunction = segments.findIndex((s, i) => i > 0 && CONJUNCTIONS.test(s));
    if (conjunction !== -1) {
      const second = segments[conjunction + 1];
      if (!second || !READ_VERBS.test(second)) return 'unknown';
    }
    return 'read';
  }
  return 'unknown';
}

// ── Policy ────────────────────────────────────────────────────────────────

export interface ApprovalOutcome {
  allow: boolean;
  /** User-facing when denied. Honest: nothing is auto-created on their behalf. */
  reason?: string;
  class: ToolClass;
}

/**
 * Evaluate a tool call under a policy.
 *
 * - 'never'         → everything is allowed (interactive sessions, where the
 *                      human is watching the stream and can abort).
 * - 'consequential' → reads and in-app actions run; world-side effects and
 *                      unknowns pause. Unknown fails closed: a gating policy
 *                      that guesses "probably fine" is not a gate.
 * - 'always'        → only reads run; even in-app actions pause.
 */
export function evaluateApproval(
  policy: ApprovalPolicy,
  toolName: string,
  input?: Record<string, unknown>,
): ApprovalOutcome {
  const cls = classifyToolCall(toolName, input);
  if (policy === 'never') return { allow: true, class: cls };

  const gated =
    policy === 'always' ? cls !== 'read' : cls === 'consequential' || cls === 'unknown';

  if (!gated) return { allow: true, class: cls };

  return {
    allow: false,
    class: cls,
    reason:
      `${baseToolName(toolName)} was not run: this is an unattended execution and the tool ` +
      `${cls === 'unknown' ? 'could not be classified as safe' : 'has effects outside the app'}. ` +
      `Describe what you would have done instead. The user can run this goal interactively, ` +
      `or set its approval policy to allow it unattended.`,
  };
}
