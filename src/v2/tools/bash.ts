import {Buffer} from 'node:buffer';
import {createBashTool, type BashOperations} from '@earendil-works/pi-coding-agent';
import type {Sandbox} from '../sandbox.ts';

/**
 * Adapts Execa's streams and error states to Pi's bash operation contract.
 */
export function createBashOperations(sandbox: Sandbox): BashOperations {
  return {
    /**
     * Streams without retaining a second buffered copy of command output.
     */
    async exec(command, commandCwd, {onData, signal, timeout}) {
      try {
        const quotedCommand = `'${command.replaceAll('\'', '\'"\'"\'')}'`;
        const {process} = await sandbox.run(`sh -c ${quotedCommand}`, {
          cwd: commandCwd,
          ...(signal !== undefined && {cancelSignal: signal}),
          ...(timeout !== undefined && {timeout: timeout * 1000}),
          all: true,
          buffer: false,
          reject: false,
        });
        process.all?.on('data', (data: Uint8Array) => {
          onData(Buffer.from(data));
        });
        const result = await process;
        if (result.isCanceled) {
          throw new Error('aborted');
        }

        if (result.timedOut) {
          throw new Error(`timeout:${String(timeout)}`);
        }

        return {exitCode: result.exitCode ?? null};
      } catch (error) {
        if (signal?.aborted === true) {
          throw new Error('aborted', {cause: error});
        }

        throw error;
      }
    },
  };
}

/**
 * Keeps Pi's bash UI while preventing host session-environment exposure.
 */
export function createSandboxBashTool(cwd: string, sandbox: Sandbox): ReturnType<typeof createBashTool> {
  return createBashTool(cwd, {operations: createBashOperations(sandbox), exposeSessionEnvironment: false});
}
