import {createWriteTool, type WriteOperations} from '@earendil-works/pi-coding-agent';
import type {Sandbox} from '../sandbox.ts';

/**
 * Shares sandboxed writes with edit without invoking another tool.
 */
export function createWriteOperations(sandbox: Sandbox): WriteOperations {
  return {
    /**
     * Keeps parent-directory creation inside the sandbox.
     */
    async mkdir(path) {
      const quotedPath = `'${path.replaceAll('\'', '\'"\'"\'')}'`;
      const {process} = await sandbox.run(`mkdir -p -- ${quotedPath}`, {reject: false});
      const result = await process;
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim().length > 0 ? result.stderr.trim() : `Cannot create ${path}`);
      }
    },
    /**
     * Sends content through stdin instead of embedding it in shell syntax.
     */
    async writeFile(path, content) {
      const quotedPath = `'${path.replaceAll('\'', '\'"\'"\'')}'`;
      const {process} = await sandbox.run(`cat > ${quotedPath}`, {input: content, reject: false});
      const result = await process;
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim().length > 0 ? result.stderr.trim() : `Cannot write ${path}`);
      }
    },
  };
}

/**
 * Retains Pi's write behavior while replacing its filesystem access.
 */
export function createSandboxWriteTool(cwd: string, sandbox: Sandbox): ReturnType<typeof createWriteTool> {
  return createWriteTool(cwd, {operations: createWriteOperations(sandbox)});
}
