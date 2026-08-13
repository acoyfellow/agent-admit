# agent-admit

A function.

You pass an action.
The function returns yes or no.
If no, you do not run the action.

```ts
import { admit } from "./src/admit.ts";

admit({ kind: "write", path: "./.env", content: "FOO=1" });
// { allow: false, reason: "refuse to write secret-shaped path ./.env" }

admit({ kind: "bash", command: "ls" });
// { allow: true, reason: "bash allowed" }
```

```sh
npm test
node --experimental-strip-types src/cli.ts write ./.env FOO=1
# exit 2
node --experimental-strip-types src/cli.ts bash ls
# exit 0
```

The function says no when:

- the command is `git commit` with hooks off
- the command is `git push --force` to `main`
- the path is `.env`, `.dev.vars`, or a project `.npmrc`
- the text looks like a known token (`sk-`, `ghp_`, …)
- a lockfile lists a package host that is not in `policy.json`

The model does not write this function on this turn.

## License

MIT
