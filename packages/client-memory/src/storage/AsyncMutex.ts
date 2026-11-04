/**
 * Lightweight AsyncMutex for single-writer serialization with timeout watchdog.
 */
export class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async runExclusive<T>(fn: () => Promise<T>, timeoutMs = 15000): Promise<T> {
    await this.acquire(timeoutMs);
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`[AsyncMutex] Execution timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      this.release();
    }
  }

  private acquire(timeoutMs: number): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          reject(new Error(`[AsyncMutex] Lock acquisition timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const entry = () => {
        resolved = true;
        clearTimeout(timer);
        resolve();
      };
      this.queue.push(entry);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}
