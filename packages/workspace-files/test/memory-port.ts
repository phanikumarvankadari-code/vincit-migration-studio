import type { FilePort, PortEntry } from '../src/index.js';

/** A FilePort in memory, for tests. */
export class MemoryPort implements FilePort {
  readonly files = new Map<string, Uint8Array>();
  private readonly enc = new TextEncoder();
  private readonly dec = new TextDecoder();
  private key = (p: readonly string[]): string => p.join('/');

  async list(path: readonly string[]): Promise<PortEntry[]> {
    const prefix = path.length === 0 ? '' : `${this.key(path)}/`;
    const seen = new Map<string, 'file' | 'dir'>();
    for (const k of this.files.keys()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) seen.set(rest, 'file');
      else seen.set(rest.slice(0, slash), 'dir');
    }
    return [...seen].map(([name, kind]) => ({ name, kind }));
  }
  async readBytes(path: readonly string[]): Promise<Uint8Array | undefined> {
    return this.files.get(this.key(path));
  }
  async writeBytes(path: readonly string[], bytes: Uint8Array): Promise<void> {
    this.files.set(this.key(path), bytes);
  }
  async readText(path: readonly string[]): Promise<string | undefined> {
    const b = this.files.get(this.key(path));
    return b ? this.dec.decode(b) : undefined;
  }
  async writeText(path: readonly string[], text: string): Promise<void> {
    this.files.set(this.key(path), this.enc.encode(text));
  }
  async remove(path: readonly string[]): Promise<void> {
    const k = this.key(path);
    for (const f of [...this.files.keys()])
      if (f === k || f.startsWith(`${k}/`)) this.files.delete(f);
  }
}
