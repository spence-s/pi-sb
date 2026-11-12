import {createEditTool, type EditOperations} from '@earendil-works/pi-coding-agent';
import type {Sandbox} from '../sandbox.ts';
import {createReadOperations} from './read.ts';
import {createWriteOperations} from './write.ts';

/**
 * Keeps edit on the same sandboxed read and write paths as the other tools.
 */
export function createEditOperations(sandbox: Sandbox): EditOperations {
  return {
    ...createReadOperations(sandbox),
    ...createWriteOperations(sandbox),
    /**
     * Requires both permissions before Pi attempts an edit.
     */
    async access(path) {
      const quotedPath = `'${path.replaceAll('\'', '\'"\'"\'')}'`;
      const {process} = await sandbox.run(`test -r ${quotedPath} && test -w ${quotedPath}`, {reject: false});
      const result = await process;
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim().length > 0 ? result.stderr.trim() : `Cannot edit ${path}`);
      }
    },
  };
}

/**
 * Retains Pi's edit matching and formatting without host filesystem writes.
 */
export function createSandboxEditTool(cwd: string, sandbox: Sandbox): ReturnType<typeof createEditTool> {
  return createEditTool(cwd, {operations: createEditOperations(sandbox)});
}
