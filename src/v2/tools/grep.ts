import {
  createGrepTool,
  DEFAULT_MAX_BYTES,
  formatSize,
  truncateHead,
  truncateLine,
  type GrepToolDetails,
} from '@earendil-works/pi-coding-agent';
import type {Sandbox} from '../sandbox.ts';
import {createReadOperations} from './read.ts';

// Reuse Pi's exact execute signature so this replacement cannot drift from the tool it overrides.
type GrepExecute = ReturnType<typeof createGrepTool>['execute'];

/**
 * Describes only the part of an `rg --json` event used below.
 *
 * Every field is optional because ripgrep emits several event kinds (`begin`, `match`,
 * `context`, `end`, and `summary`), and some paths or lines may be encoded as raw bytes
 * instead of text. We ignore events that do not contain the three text fields needed to
 * produce Pi's normal `path:line: text` output.
 */
type RipgrepEvent = {
  type?: string;
  data?: {
    path?: {text?: string};
    lines?: {text?: string};
    line_number?: number;
  };
};

/**
 * Runs ripgrep inside the sandbox while preserving Pi's global match limit.
 *
 * Plain output would let `head` count rows directly, but parsing `path:line:text` is
 * ambiguous when filenames or source text contain separators. JSON preserves those field
 * boundaries; its event format is documented at
 * https://docs.rs/grep-printer/latest/grep_printer/struct.JSON.html.
 *
 * Match events are filtered before `head` so JSON lifecycle events do not count toward the
 * limit. Context is reconstructed afterward because piping ripgrep's context output through
 * `head` would count context rows as matches and could cut off the final match's trailing context.
 */
export function createSandboxGrepTool(cwd: string, sandbox: Sandbox): ReturnType<typeof createGrepTool> {
  const readOperations = createReadOperations(sandbox);
  // Search, formatting, and errors stay together to keep the flow readable.
  const execute: GrepExecute = async (_id, {pattern, path = '.', glob, ignoreCase, literal, context, limit = 100}, signal) => {
    const arguments_ = [
      'rg',
      '--json',
      '--line-number',
      '--color=never',
      '--hidden',
      '--glob',
      '!.git/**',
      '--glob',
      '!node_modules/**',
      ...(ignoreCase === true ? ['--ignore-case'] : []),
      ...(literal === true ? ['--fixed-strings'] : []),
      ...(glob === undefined ? [] : ['--glob', glob]),
      '--',
      pattern,
      path,
    ];

    const effectiveLimit = Math.max(1, Math.floor(limit));
    const contextLines = Math.max(0, Math.floor(context ?? 0));
    let result;
    let destination;
    try {
      const {process: head} = await sandbox.run(`head -n ${effectiveLimit}`, {
        cwd,
        ...(signal !== undefined && {cancelSignal: signal}),
      });
      destination = head;
      const command = arguments_.map(argument => `'${argument.replaceAll('\'', '\'"\'"\'')}'`).join(' ');
      const {process: source} = await sandbox.run(command, {
        cwd,
        ...(signal !== undefined && {cancelSignal: signal}),
        reject: false,
        buffer: {stdout: false},
        /**
         * Keeps only complete match events so `head` counts matches rather than JSON records.
         * @yields Compact match records.
         */
        * stdout(line: string) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const event = JSON.parse(line) as RipgrepEvent;
          const eventPath = event.data?.path?.text;
          const lineNumber = event.data?.line_number;
          const text = event.data?.lines?.text;
          if (eventPath === undefined
            || lineNumber === undefined
            || text === undefined
            || event.type !== 'match') {
            return;
          }

          yield JSON.stringify({path: eventPath, lineNumber, text});
        },
      });
      const pipeline = await source.pipe(head);
      const pipelineResults = [pipeline, ...pipeline.pipedFrom];
      if (pipelineResults.some(entry => entry.isCanceled)) {
        throw new Error('Operation aborted');
      }

      result = {
        stdout: pipeline.stdout,
        stderr: pipelineResults.map(entry => entry.stderr ?? '').join(''),
        exitCode: pipelineResults.find(entry => entry.exitCode !== 0)?.exitCode ?? pipeline.exitCode,
      };
    } catch (error) {
      destination?.kill();
      await Promise.allSettled([destination]);
      if (signal?.aborted === true) {
        throw new Error('Operation aborted', {cause: error});
      }

      throw error;
    }

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      let error = result.stderr.trim().length > 0 ? result.stderr.trim() : `rg failed (${String(result.exitCode)})`;
      if (/operation not permitted|<sandbox_violations>|connection blocked by network allowlist/iv.test(error)) {
        error += `\n\n${[
          'Sandbox restriction: work in the current project, use mktemp for private temporary files,',
          'and treat global skills as read-only. Network access is limited by the configured allowlist.',
          'Do not retry an outside path or seek a host-execution workaround.',
        ].join(' ')}`;
      }

      throw new Error(error);
    }

    // Parse only the bounded, compact match records returned by `head`, not ripgrep's full event stream.
    const matches = result.stdout.length === 0
      ? []
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      : result.stdout.split('\n').map(line => JSON.parse(line) as {path: string; lineNumber: number; text: string});
    if (matches.length === 0) {
      return {content: [{type: 'text' as const, text: 'No matches found'}], details: undefined};
    }

    const fileCache = new Map<string, string[]>();
    const outputLines: string[] = [];
    let wereLinesTruncated = false;
    /*
     Ripgrep does not cap output bytes, and `--max-columns` has no effect in JSON mode (see
     the JSON docs above). Truncate each source line so one minified file cannot hide every
     later match; the final `truncateHead` still enforces Pi's 50KB cap after context expands.
     */
    for (const match of matches) {
      if (contextLines === 0) {
        const line = match.text.replace(/\r?\n$/v, '').replaceAll('\r', '');
        const truncated = truncateLine(line);
        wereLinesTruncated ||= truncated.wasTruncated;
        outputLines.push(`${match.path}:${match.lineNumber}: ${truncated.text}`);
        continue;
      }

      let fileLines = fileCache.get(match.path);
      if (fileLines === undefined) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const contents = await readOperations.readFile(match.path);
          fileLines = contents.toString().replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
        } catch {
          fileLines = [];
        }

        fileCache.set(match.path, fileLines);
      }

      if (fileLines.length === 0) {
        outputLines.push(`${match.path}:${match.lineNumber}: (unable to read file)`);
        continue;
      }

      const firstLine = Math.max(1, match.lineNumber - contextLines);
      const lastLine = Math.min(fileLines.length, match.lineNumber + contextLines);
      for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
        const truncated = truncateLine(fileLines[lineNumber - 1] ?? '');
        wereLinesTruncated ||= truncated.wasTruncated;
        const separator = lineNumber === match.lineNumber ? ':' : '-';
        outputLines.push(`${match.path}${separator}${String(lineNumber)}${separator} ${truncated.text}`);
      }
    }

    // Match count and output size are independent, especially when each match includes context.
    const truncation = truncateHead(outputLines.join('\n'), {maxLines: Number.MAX_SAFE_INTEGER});
    const details: GrepToolDetails = {};
    const notices: string[] = [];
    if (matches.length >= effectiveLimit) {
      details.matchLimitReached = effectiveLimit;
      notices.push(`${String(effectiveLimit)} matches limit reached. Refine the pattern or increase limit`);
    }

    if (truncation.truncated) {
      details.truncation = truncation;
      notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
    }

    if (wereLinesTruncated) {
      details.linesTruncated = true;
      notices.push('Some lines truncated. Use read to see full lines');
    }

    const notice = notices.length > 0 ? `\n\n[${notices.join('. ')}]` : '';
    return {
      content: [{type: 'text' as const, text: `${truncation.content}${notice}`}],
      details: notices.length > 0 ? details : undefined,
    };
  };

  // https://github.com/earendil-works/pi/issues/5354
  return {...createGrepTool(cwd), execute};
}
