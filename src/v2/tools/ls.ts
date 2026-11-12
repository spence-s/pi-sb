import {Buffer} from 'node:buffer';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {
  createLsTool,
  DEFAULT_MAX_BYTES,
  formatSize,
  type LsToolDetails,
} from '@earendil-works/pi-coding-agent';
import type {Sandbox} from '../sandbox.ts';

// Reuse Pi's exact execute signature so this replacement cannot drift from the tool it overrides.
type LsExecute = ReturnType<typeof createLsTool>['execute'];

/**
 * Lists a directory in one sandbox instead of spawning one sandbox per child stat.
 */
export function createSandboxLsTool(cwd: string, sandbox: Sandbox): ReturnType<typeof createLsTool> {
  const execute: LsExecute = async (_toolCallId, {path, limit}, signal) => {
    const requestedPath = (path === undefined || path.length === 0 ? '.' : path)
      .replace(/^@/v, '')
      .replace(/^~(?=\/|$)/v, () => homedir());
    const directory = resolve(cwd, requestedPath);
    const effectiveLimit = Math.max(0, Math.floor(limit ?? 500));
    let entryCount = 0;
    let totalBytes = 0;
    let outputBytes = 0;
    let outputLines = 0;
    let hasReachedByteLimit = false;
    let result;
    try {
      const quotedDirectory = `'${`${directory}/`.replaceAll('\'', '\'"\'"\'')}'`;
      const {process} = await sandbox.run(`ls -1Ap -- ${quotedDirectory}`, {
        cwd,
        ...(signal !== undefined && {cancelSignal: signal}),
        reject: false,
        /**
         * Bounds buffered output while still counting all directory entries.
         * @yields Entries that fit the output limits.
         */
        * stdout(entry: string) {
          entryCount++;
          if (entryCount > effectiveLimit) {
            return;
          }

          const entryBytes = Buffer.byteLength(entry);
          totalBytes += entryBytes + (entryCount > 1 ? 1 : 0);
          const nextOutputBytes = outputBytes + entryBytes + (outputLines > 0 ? 1 : 0);
          if (hasReachedByteLimit || nextOutputBytes > DEFAULT_MAX_BYTES) {
            hasReachedByteLimit = true;
            return;
          }

          outputBytes = nextOutputBytes;
          outputLines++;
          yield entry;
        },
      });
      result = await process;
      if (result.isCanceled) {
        throw new Error('Operation aborted');
      }
    } catch (error) {
      if (signal?.aborted === true) {
        throw new Error('Operation aborted', {cause: error});
      }

      throw error;
    }

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim().length > 0 ? result.stderr.trim() : `Cannot list ${directory}`);
    }

    if (entryCount === 0 || effectiveLimit === 0) {
      return {content: [{type: 'text' as const, text: '(empty directory)'}], details: undefined};
    }

    const details: LsToolDetails = {};
    const notices: string[] = [];
    if (entryCount > effectiveLimit) {
      details.entryLimitReached = effectiveLimit;
      notices.push(`${String(effectiveLimit)} entries limit reached. Use limit=${String(effectiveLimit * 2)} for more`);
    }

    if (hasReachedByteLimit) {
      details.truncation = {
        content: result.stdout,
        truncated: true,
        truncatedBy: 'bytes',
        totalLines: Math.min(entryCount, effectiveLimit),
        totalBytes,
        outputLines,
        outputBytes,
        lastLinePartial: false,
        firstLineExceedsLimit: outputLines === 0,
        maxLines: Number.MAX_SAFE_INTEGER,
        maxBytes: DEFAULT_MAX_BYTES,
      };
      notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
    }

    const notice = notices.length > 0 ? `\n\n[${notices.join('. ')}]` : '';
    return {
      content: [{type: 'text' as const, text: `${result.stdout}${notice}`}],
      details: notices.length > 0 ? details : undefined,
    };
  };

  return {...createLsTool(cwd), execute};
}
