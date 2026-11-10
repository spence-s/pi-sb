# V2 notes

## Make the sandbox temporary directory clear to the agent

Agents frequently assume they can use the OS temporary directory (for example, `/tmp`) and receive access denials. The sandbox uses a custom private temporary directory instead.

- Improve the initial sandbox instructions so the agent knows to use `$TMPDIR` or `mktemp`, rather than a hardcoded OS temporary path.
- Improve access-denial messaging for attempts to use the OS temporary directory: explain that the sandbox has a custom temporary directory and tell the agent to retry there.
