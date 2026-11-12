import {Buffer} from 'node:buffer';
import {realpathSync} from 'node:fs';
import {createReadTool, type ReadOperations} from '@earendil-works/pi-coding-agent';
import type {Sandbox} from '../sandbox.ts';

/**
 * Shares sandboxed reads with edit and grep without invoking another tool.
 */
export function createReadOperations(sandbox: Sandbox): ReadOperations {
  return {
    /**
     * Checks access inside the sandbox rather than relying on host permissions.
     */
    async access(path) {
      const quotedPath = `'${realpathSync(path).replaceAll('\'', '\'"\'"\'')}'`;
      const {process} = await sandbox.run(`test -r ${quotedPath}`, {reject: false});
      const result = await process;
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim().length > 0 ? result.stderr.trim() : `Cannot read ${path}`);
      }
    },
    /**
     * Preserves binary content across the sandbox's shell boundary.
     */
    async readFile(path) {
      const quotedPath = `'${realpathSync(path).replaceAll('\'', '\'"\'"\'')}'`;
      const {process} = await sandbox.run(`base64 < ${quotedPath}`, {reject: false});
      const result = await process;
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim().length > 0 ? result.stderr.trim() : `Cannot read ${path}`);
      }

      return Buffer.from(result.stdout, 'base64');
    },
    /**
     * Keeps image inspection subject to the same policy as reading the file.
     */
    async detectImageMimeType(path) {
      const quotedPath = `'${realpathSync(path).replaceAll('\'', '\'"\'"\'')}'`;
      const {process} = await sandbox.run(`file --mime-type -b -- ${quotedPath}`, {reject: false});
      const result = await process;
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim().length > 0 ? result.stderr.trim() : `Cannot identify ${path}`);
      }

      const mime = result.stdout.trim();
      return ['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(mime) ? mime : null;
    },
  };
}

/**
 * Retains Pi's read behavior while replacing its filesystem access.
 */
export function createSandboxReadTool(cwd: string, sandbox: Sandbox): ReturnType<typeof createReadTool> {
  return createReadTool(cwd, {operations: createReadOperations(sandbox)});
}
