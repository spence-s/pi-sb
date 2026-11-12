import {
  basename,
  isAbsolute,
  matchesGlob,
  resolve,
} from 'node:path';
import {createFindTool, type FindOperations} from '@earendil-works/pi-coding-agent';
import type {Sandbox} from '../sandbox.ts';

/**
 * Keeps glob matching on the host but filesystem enumeration inside the sandbox.
 */
export function createFindOperations(sandbox: Sandbox): FindOperations {
  return {
    /**
     * Uses sandbox permissions rather than host filesystem visibility.
     */
    async exists(path) {
      const quotedPath = `'${path.replaceAll('\'', '\'"\'"\'')}'`;
      const {process} = await sandbox.run(`test -e ${quotedPath}`, {reject: false});
      const result = await process;
      return result.exitCode === 0;
    },
    /**
     * Limits matches after glob filtering without buffering the entire file list.
     */
    async glob(pattern, path, {ignore, limit}) {
      const arguments_ = [
        'rg',
        '--files',
        '--hidden',
        ...ignore.flatMap(entry => [
          '--glob',
          `!${entry}`,
          ...(entry.startsWith('**/') ? ['--glob', `!${entry.slice(3)}`] : []),
        ]),
        '--',
      ];
      const effectiveLimit = Math.max(0, Math.floor(limit));
      const command = arguments_.map(argument => `'${argument.replaceAll('\'', '\'"\'"\'')}'`).join(' ');
      const {process: destination} = await sandbox.run(`head -n ${effectiveLimit}`, {cwd: path});
      let result;
      try {
        const {process: source} = await sandbox.run(command, {
          cwd: path,
          reject: false,
          buffer: {stdout: false},
          /**
           * Preserves Pi's basename, absolute, and relative glob matching behavior.
         * @yields Matching file paths.
           */
          * stdout(candidate: string) {
            if (!pattern.includes('/')) {
              if (matchesGlob(basename(candidate), pattern)) {
                yield candidate;
              }

              return;
            }

            if (isAbsolute(pattern)) {
              if (matchesGlob(resolve(path, candidate), pattern)) {
                yield candidate;
              }

              return;
            }

            if (matchesGlob(candidate, pattern) || matchesGlob(candidate, `**/${pattern}`)) {
              yield candidate;
            }
          },
        });
        const pipeline = await source.pipe(destination);
        const pipelineResults = [pipeline, ...pipeline.pipedFrom];
        result = {
          stdout: pipeline.stdout,
          stderr: pipelineResults.map(entry => entry.stderr ?? '').join(''),
          exitCode: pipelineResults.find(entry => entry.exitCode !== 0)?.exitCode ?? pipeline.exitCode,
        };
      } catch (error) {
        destination.kill();
        await Promise.allSettled([destination]);
        throw error;
      }

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(result.stderr.trim().length > 0 ? result.stderr.trim() : `Cannot find ${pattern}`);
      }

      return result.stdout.trim().split('\n').filter(Boolean);
    },
  };
}

/**
 * Retains Pi's find formatting while replacing its filesystem enumeration.
 */
export function createSandboxFindTool(cwd: string, sandbox: Sandbox): ReturnType<typeof createFindTool> {
  return createFindTool(cwd, {operations: createFindOperations(sandbox)});
}
