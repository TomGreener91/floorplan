# Floorplan in Antigravity

This fork adds [Google Antigravity](https://antigravity.google) as a third agent alongside Claude Code and Codex. Antigravity runs the same skill, scripts and map, and the map's prompts name Antigravity:

- The Health panel's prompts say **Fix with Antigravity**.
- On a blueprint, each part says **Build this with Antigravity**.
- The Ask bar runs your own Antigravity CLI.

Upstream: [haydenschmitty/floorplan](https://github.com/haydenschmitty/floorplan). This fork doesn't send changes back.

## What you need

- Antigravity (the app, the IDE or the CLI), signed in with your Google account.
- [Node.js](https://nodejs.org) 18 or newer.
- **For the Ask bar only:** the [Antigravity CLI](https://antigravity.google/docs/cli/install) (`agy`), signed in once by running `agy` in a terminal. The map's server has to launch an agent and read its answer back, and the Agent Manager app can't be called by another program. Without the CLI, everything else works: the map, Health, Screens, Recent work and the Fix with Antigravity prompts. The Ask bar then shows a hint to install the CLI.

| | Agent Manager only | Needs `agy` |
|---|---|---|
| Draw and update the map | ✅ | |
| Map, Health, Screens, Recent work, flows you've already saved | ✅ | |
| Fix with Antigravity (copy the prompt, paste it into the Agent Manager) | ✅ | |
| Ask bar, Request a new flow, changing a blueprint from the map | | ✅ |

## Install

**As a plugin** (the CLI and the app share plugins):

```bash
agy plugin install https://github.com/TomGreener91/floorplan
```

The plugin manifest is `.antigravity-plugin/plugin.json`, and the skill is in `skills/floorplan/`. Run the same command again to update.

**As a plain skill:** copy `skills/floorplan/` to `~/.gemini/config/skills/floorplan/` (every workspace) or `<project>/.agents/skills/floorplan/` (one project). A skills sync tool works too: add `skills/floorplan` as a skill and sync it to Antigravity.

## Make your first map

Open your project in Antigravity and ask:

> Draw a floorplan of this codebase

Or type `/floorplan`. What happens next:

1. Antigravity checks whether `floorplan/` already exists.
2. If not, it scans the code, describes every part, file and web request, and builds the map.
3. It starts the map's local server and opens `http://127.0.0.1:4378`.
4. Later, "update the floorplan" re-reads only what changed and highlights it under **Recent work**. Open tabs reload by themselves.

**The server needs to run outside the sandbox.** It keeps running after the command ends, so Antigravity may ask you to approve that. If you'd rather not, run it yourself from the project folder:

```bash
node floorplan/serve.mjs
```

It stops on its own two hours after the last map tab closes. To stop it now, run `node floorplan/serve.mjs --stop`.

## Asking questions on the map

The Ask bar runs `agy -p` on your computer, in your project folder, on your own sign-in:

- It asks for the answer's JSON shape (`--json-schema`) and reads Antigravity's `stream-json` events. That's how the map shows "Searching the map for …" and "Reading …" while it works.
- It runs in Antigravity's **default** mode, where the agent may read your workspace. File edits and commands without an allow rule are refused, because nobody is there to approve them. As a second safeguard, if Antigravity starts to edit a file in your project, Floorplan stops the run. Antigravity's own notes (artifacts) are kept outside your project and are left alone.
- A follow-up question resumes the same Antigravity conversation (`--conversation`).

**Make answers faster:** let Antigravity run the map's own lookups without asking. Add this to `permissions.allow` in `~/.gemini/antigravity-cli/settings.json`:

```json
{
  "permissions": {
    "allow": ["command(node floorplan/query.mjs)"]
  }
}
```

Without it, the agent can't use the map's lookups and reads source files and `floorplan/graph.json` instead, which is slower and uses more tokens. `open.mjs` prints a tip when the rule is missing.

**Choosing the CLI, the model and the mode:**

```bash
node floorplan/serve.mjs --engine antigravity          # the default for maps Antigravity built
node floorplan/serve.mjs --antigravity /path/to/agy    # an unusual install
node floorplan/serve.mjs --model <slug>                # see `agy models`
node floorplan/serve.mjs --agy-mode plan               # another Antigravity mode, if default misbehaves
```

The server finds `agy` on your PATH, in `~/.local/bin`, or in `%LOCALAPPDATA%\agy\bin` on Windows.

A map Antigravity built sticks to Antigravity, so its prompts and Ask bar always agree. Maps built by Claude Code or Codex behave as upstream does and fall back to whichever of those two is installed. Use `--engine claude` or `--engine codex` to answer through one of those instead.

## How the agent is detected

Claude Code and Codex set environment variables for every command they run, and Floorplan looks for those. Antigravity documents none, so **this fork assumes Antigravity when it doesn't recognise Claude Code or Codex**. Upstream assumes Claude Code. To say so yourself, pass `--agent antigravity|claude|codex` to `build.mjs`, or set `FLOORPLAN_AGENT`.

## A rule for future sessions (optional)

Claude Code can keep a note in `CLAUDE.local.md`. In Antigravity, the equivalent is a workspace rule:

- **What it is:** a short always-on rule in `.agents/rules/floorplan.md` that tells future sessions the map exists and how to look things up in it. The agent then starts from the map instead of searching the code from scratch.
- **When it's added:** only if you say yes. Floorplan asks once, then runs `build.mjs <root> --agy-rule`.
- **Out of git:** it's kept out of commits through `.git/info/exclude`, not `.gitignore`.
- **Kept current:** once it exists, every build updates it.
- **To switch it off:** delete it, or put `<!-- floorplan:off -->` in it.

## Open in editor

The map's **Open in editor** button defaults to VS Code. To open files in Antigravity's editor:

```bash
node floorplan/serve.mjs --editor antigravity          # antigravity-ide://file/…
node floorplan/serve.mjs --editor antigravity-legacy   # antigravity://file/… (older versions)
```

You can also set `"editor": "antigravity"` in `floorplan/architecture.json`. Which link works depends on your Antigravity version, so try the first one before the second.

## Known limits

- **`agy -p` from another program:** some CLI versions have had bugs here, either printing nothing or hanging when not attached to a terminal ([#76](https://github.com/google-antigravity/antigravity-cli/issues/76), [#318](https://github.com/google-antigravity/antigravity-cli/issues/318)). If the Ask bar never answers, update the CLI (`agy update`) and check that `agy -p "hi" --output-format stream-json > out.txt` writes something.
- **Per-run permissions:** Antigravity reads its permission rules only from `settings.json`, never per run. So Floorplan can't fence each question the way it does in Claude Code. It relies on the default mode, its instructions and the edit safeguard above.
- **No Claude app route:** publishing the map to the Claude app is a Claude feature.

## Keeping the fork up to date

`main` holds the Antigravity changes on top of upstream. To pull in a new upstream release:

```bash
git remote add upstream https://github.com/haydenschmitty/floorplan.git   # once
git fetch upstream
git merge upstream/main
node --test
node tools/checksums.mjs   # refresh CHECKSUMS.txt after the merge
```

The Antigravity changes are mostly self-contained:

- `scripts/lib/agent.mjs`
- the `antigravity` engine in `assets/serve.mjs`
- `writeAgyRule` in `scripts/lib/claudemd.mjs`
- `.antigravity-plugin/`
- the Dependencies view: `assets/ui/35-deps.js`, `deps` / `loops` / `fileLinks` in `assets/graph-query.js`, `importLoops` in `scripts/lib/health.mjs`
- Vue components with no import line: `scripts/lib/vue-components.mjs`, and the `@/` handling in `scripts/lib/resolve.mjs`
- this page

Conflicts usually land in `SKILL.md` and the viewer's `AGENT` block.
