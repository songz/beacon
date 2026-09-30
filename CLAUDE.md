# beacon — guidance for Claude

## Keep this file alive

**Whenever you learn something non-obvious about this codebase during a session
— about how it's shaped, why a design choice exists, how a subsystem behaves,
or where a bug class lives — append it to the right section below before
ending the turn.** Stay at the altitude of enduring concepts; details that
will rot fast (line numbers, current implementations, in-flight state)
belong in commits or memory, not here.

## Architecture & behavior

- Java 21 on purpose (the interview's language), not the house Node default. Build with the
  Gradle wrapper (`./gradlew build`), JDK from `~/.local/jdk/jdk-21*`; no global install.
- The client is three plain files under `web/` with no build step, so an interviewer can read
  the crypto in the browser's view-source. Deliberate deviation from the React default.
- `web/` is served from disk when the process runs in the checkout and from the jar otherwise,
  so a page edit is live without a rebuild in dev but the fat jar still ships everything.
- The server never sees a seed or a plaintext location. Everything it stores is either a public
  key or a ciphertext; the README's "what is real Find My and what is toy" table is the contract.
- The git history is the walkthrough: one commit per concept, in the README's order. Keep new
  work in the same spirit (one readable commit, message a reader can follow).

## Gotchas — landmines and invariants worth checking first

- The shell exports `NODE_ENV=production`; irrelevant for Gradle but `run.sh` loads `.env` with
  `set -a` so PORT and REPLICA_* come from the file, never from the caller's environment.
