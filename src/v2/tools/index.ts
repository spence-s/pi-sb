import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import type {Sandbox} from '../sandbox.ts';
import {createReadOperations, createSandboxReadTool} from './read.ts';
import {createWriteOperations, createSandboxWriteTool} from './write.ts';
import {createEditOperations, createSandboxEditTool} from './edit.ts';
import {createBashOperations, createSandboxBashTool} from './bash.ts';
import {createFindOperations, createSandboxFindTool} from './find.ts';
import {createSandboxLsTool} from './ls.ts';
import {createSandboxGrepTool} from './grep.ts';

export class SandboxTools {
  pi: ExtensionAPI;
  cwd: string;
  sandbox: Sandbox;

  /**
   * Keeps tool registration separate from sandbox lifecycle ownership.
   */
  constructor(pi: ExtensionAPI, cwd: string, sandbox: Sandbox) {
    this.pi = pi;
    this.cwd = cwd;
    this.sandbox = sandbox;
  }

  /**
   * Exposes the sandboxed operations used by Pi's read tool.
   */
  get readOperations() {
    return createReadOperations(this.sandbox);
  }

  /**
   * Exposes the sandboxed operations used by Pi's write tool.
   */
  get writeOperations() {
    return createWriteOperations(this.sandbox);
  }

  /**
   * Exposes the sandboxed operations used by Pi's edit tool.
   */
  get editOperations() {
    return createEditOperations(this.sandbox);
  }

  /**
   * Exposes the sandboxed operations used by Pi's bash tool.
   */
  get bashOperations() {
    return createBashOperations(this.sandbox);
  }

  /**
   * Exposes the sandboxed operations used by Pi's find tool.
   */
  get findOperations() {
    return createFindOperations(this.sandbox);
  }

  /**
   * Preserves direct access to the replacement grep execution contract.
   */
  get grepExecute() {
    return this.grep.execute;
  }

  /**
   * Preserves direct access to the replacement ls execution contract.
   */
  get lsExecute() {
    return this.ls.execute;
  }

  /**
   * Retains Pi's tool definition with sandboxed read execution.
   */
  get read(): ReturnType<typeof createSandboxReadTool> {
    return createSandboxReadTool(this.cwd, this.sandbox);
  }

  /**
   * Retains Pi's tool definition with sandboxed write execution.
   */
  get write(): ReturnType<typeof createSandboxWriteTool> {
    return createSandboxWriteTool(this.cwd, this.sandbox);
  }

  /**
   * Retains Pi's tool definition with sandboxed edit execution.
   */
  get edit(): ReturnType<typeof createSandboxEditTool> {
    return createSandboxEditTool(this.cwd, this.sandbox);
  }

  /**
   * Retains Pi's tool definition with sandboxed bash execution.
   */
  get bash(): ReturnType<typeof createSandboxBashTool> {
    return createSandboxBashTool(this.cwd, this.sandbox);
  }

  /**
   * Retains Pi's tool definition with sandboxed find execution.
   */
  get find(): ReturnType<typeof createSandboxFindTool> {
    return createSandboxFindTool(this.cwd, this.sandbox);
  }

  /**
   * Retains Pi's tool definition with sandboxed ls execution.
   */
  get ls(): ReturnType<typeof createSandboxLsTool> {
    return createSandboxLsTool(this.cwd, this.sandbox);
  }

  /**
   * Retains Pi's tool definition with sandboxed grep execution.
   */
  get grep(): ReturnType<typeof createSandboxGrepTool> {
    return createSandboxGrepTool(this.cwd, this.sandbox);
  }

  /**
   * Registers sandboxed replacements without changing Pi's default tool selection.
   *
   * Pi still activates tools named by its defaults, settings, or CLI flags. Marking
   * every override as non-default prevents registration itself from enabling optional
   * built-ins while keeping the sandboxed definition available when Pi activates one.
   */
  register(): void {
    this.pi.registerTool({...this.read, defaultActive: false});
    this.pi.registerTool({...this.write, defaultActive: false});
    this.pi.registerTool({...this.edit, defaultActive: false});
    this.pi.registerTool({...this.bash, defaultActive: false});
    this.pi.registerTool({...this.find, defaultActive: false});
    this.pi.registerTool({...this.ls, defaultActive: false});
    this.pi.registerTool({...this.grep, defaultActive: false});
  }
}

