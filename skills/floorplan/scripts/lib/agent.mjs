// Which coding agent is running the skill: Antigravity, Claude Code or Codex. The map records it, so its Ask bar
// and "Fix with …" prompts name the right one, and serve.mjs answers through the same CLI.
// --agent <name> (or FLOORPLAN_AGENT) decides; otherwise Claude Code and Codex are recognised by the variables
// they set for every command they run. Antigravity sets none that are documented, so in this fork anything else
// is taken to be Antigravity. Adding an agent is an entry here.
// "none" is for maps made without an agent session (in CI, in scripts, from your own tooling): the map then
// names no agent in its prompts. Unattended mode (FLOORPLAN_UNATTENDED=1) implies it unless one is named.
import { isUnattended } from './common.mjs';

const DETECT = {
  claude: (env) => !!(env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT),
  codex: (env) => !!(env.CODEX_THREAD_ID || env.CODEX_SESSION_ID),
  // best effort: no variable is documented, so this only catches ones a future version may add
  antigravity: (env) => Object.keys(env).some((k) => /^(ANTIGRAVITY|AGY)_/.test(k)),
  none: () => false, // only when asked for, or in unattended mode
};
export const AGENTS = Object.keys(DETECT);
/** The agent assumed when none is recognised: this fork is for Antigravity. */
export const DEFAULT_AGENT = 'antigravity';

export function detectAgent(args = {}, env = process.env) {
  const v = String(args.agent || env.FLOORPLAN_AGENT || '').toLowerCase();
  if (AGENTS.includes(v)) return v;
  if (isUnattended(env)) return 'none';
  return AGENTS.find((a) => DETECT[a](env)) || DEFAULT_AGENT;
}

const CLI_NAMES = { claude: 'the Claude Code CLI', codex: 'Codex', antigravity: 'the Antigravity CLI' };
// the command each CLI answers to, and the words its --version prints
const COMMANDS = { claude: 'claude', codex: 'codex', antigravity: 'agy' };
const OWN_NAME = { claude: /claude/i, codex: /codex/i, antigravity: /agy|antigravity/i };
/**
 * What the CLI answering the map's questions is called, for open.mjs: its usual name, or, when its --version
 * names another program (a wrapper installed under the same command, `devin 3000.11.238` answering to
 * `claude`), that program, so the label never claims Claude Code, Codex or Antigravity for something else.
 */
export function cliLabel(engine, version = '') {
  const key = Object.hasOwn(CLI_NAMES, engine) ? engine : 'claude';
  const usual = CLI_NAMES[key];
  const v = String(version || '').trim();
  const named = /^([A-Za-z][\w.-]{0,40})\s+v?\d/.exec(v)?.[1];
  if (!named || OWN_NAME[key].test(v)) return usual;
  return `${named}, found as the ${COMMANDS[key]} command`;
}
