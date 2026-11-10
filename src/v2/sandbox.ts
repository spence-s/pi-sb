import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {SandboxManager, SandboxRuntimeConfigSchema, type SandboxRuntimeConfig} from '@anthropic-ai/sandbox-runtime';
import {execa, type Options} from 'execa';

/**
 * Exposes a subset of execa options
 */
export type RunOptions<T extends Options = Options> = T extends Options ? Pick<T,
  | 'input'
  | 'stdin'
  | 'stdout'
  | 'stderr'
  | 'all'
  | 'buffer'
  | 'encoding'
  | 'lines'
  | 'reject'
  | 'timeout'
  | 'cancelSignal'
  | 'maxBuffer'
  | 'killSignal'
  | 'forceKillAfterDelay'
> : never;

// SRT owns one process-wide runtime, not an independent runtime per instance.
let activeSandbox: symbol | undefined;

export class Sandbox {
  private readonly id = Symbol('Sandbox');
  private scratchPath: string | undefined;
  private commandCount = 0;
  private readonly cwd: string;
  private readonly config: SandboxRuntimeConfig;

  /**
   * Keeps policy explicit and independent of Pi or configuration-file discovery.
   */
  constructor(cwd: string, config: SandboxRuntimeConfig) {
    this.cwd = cwd;
    this.config = SandboxRuntimeConfigSchema.parse(config);
  }

  /**
   * Reserves SRT's shared runtime and keeps its sockets in private writable storage.
   */
  async start(): Promise<void> {
    if (activeSandbox !== undefined || SandboxManager.getConfig() !== undefined) {
      throw new Error('A sandbox is already active.');
    }

    activeSandbox = this.id;
    let scratchPath: string | undefined;
    try {
      scratchPath = await mkdtemp(join(tmpdir(), 'sloppi-v2-'));
      scratchPath = await realpath(scratchPath);
      const config = SandboxRuntimeConfigSchema.parse(this.config);
      config.filesystem.allowWrite.push(scratchPath);
      config.network.allowUnixSockets = [...(config.network.allowUnixSockets ?? []), scratchPath];

      // SRT creates proxy sockets using os.tmpdir(); do not leak this override to host tools.
      const previousTmpdir = process.env.TMPDIR;
      process.env.TMPDIR = scratchPath;
      try {
        await SandboxManager.initialize(config);
      } finally {
        if (previousTmpdir === undefined) {
          delete process.env.TMPDIR;
        } else {
          process.env.TMPDIR = previousTmpdir;
        }
      }

      this.scratchPath = scratchPath;
    } catch (error) {
      try {
        await SandboxManager.reset();
      } finally {
        activeSandbox = undefined;
        if (scratchPath !== undefined) {
          await rm(scratchPath, {recursive: true, force: true});
        }
      }

      throw error;
    }
  }

  /**
   * Exposes Execa without awaiting its thenable subprocess or recreating its APIs.
   * Options are trusted host code: file-backed stdio and transforms run outside SRT.
   * Pipe only into another sandbox.run() subprocess to keep both commands isolated.
   */
  async run<const OptionsType extends RunOptions = Record<string, unknown>>(command: string, options?: OptionsType) {
    const {scratchPath} = this;
    if (scratchPath === undefined) {
      throw new Error('Sandbox has not started.');
    }

    this.commandCount++;
    let isWrapped = false;
    try {
      const temporaryPath = `'${scratchPath.replaceAll('\'', '\'"\'"\'')}'`;
      const executable = await SandboxManager.wrapWithSandbox(
        `export TMPDIR=${temporaryPath} CLAUDE_CODE_TMPDIR=${temporaryPath}\n${command}`,
        undefined,
        undefined,
        options?.cancelSignal,
      );
      isWrapped = true;
      const subprocess = execa(executable, {
        ...options,
        cwd: this.cwd,
        shell: true,
        extendEnv: false,
        env: {
          HOME: scratchPath,
          TMPDIR: scratchPath,
          CLAUDE_CODE_TMPDIR: scratchPath,
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
          LANG: process.env.LANG ?? 'C.UTF-8',
          NODE_USE_ENV_PROXY: '1',
          USER: 'sandbox',
        },
        cleanup: true,
        detached: false,
        killDescendants: true,
      });

      /**
       * Releases wrapper resources on success and failure without replacing the subprocess.
       */
      const cleanup = () => {
        this.commandCount--;
        SandboxManager.cleanupAfterCommand();
      };

      void subprocess.then(cleanup, cleanup);
      return {process: subprocess};
    } catch (error) {
      this.commandCount--;
      if (isWrapped) {
        SandboxManager.cleanupAfterCommand();
      }

      throw error;
    }
  }

  /**
   * Requires callers to finish commands before removing the resources they depend on.
   */
  async stop(): Promise<void> {
    if (activeSandbox !== this.id) {
      return;
    }

    if (this.scratchPath === undefined || this.commandCount > 0) {
      throw new Error('Wait for sandbox startup and commands to finish before stopping.');
    }

    const {scratchPath} = this;
    this.scratchPath = undefined;
    try {
      await SandboxManager.reset();
    } finally {
      try {
        await rm(scratchPath, {recursive: true, force: true});
      } finally {
        activeSandbox = undefined;
      }
    }
  }
}
