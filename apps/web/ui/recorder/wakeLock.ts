export type WakeLockState = 'idle' | 'held' | 'unsupported' | 'refused';

interface Sentinel {
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

export interface WakeLockHost {
  request?: (type: 'screen') => Promise<Sentinel>;
}

export class ScreenWakeLock {
  private sentinel: Sentinel | undefined;
  private wanted = false;
  state: WakeLockState = 'idle';

  constructor(
    private readonly host: WakeLockHost | undefined,
    private readonly onChange: (state: WakeLockState) => void = () => undefined,
  ) {}

  async acquire(): Promise<void> {
    this.wanted = true;
    await this.request();
  }

  async reacquire(): Promise<void> {
    if (this.wanted && !this.sentinel) await this.request();
  }

  async release(): Promise<void> {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = undefined;
    await sentinel?.release().catch(() => undefined);
    this.set('idle');
  }

  private async request(): Promise<void> {
    if (!this.host?.request) {
      this.set('unsupported');
      return;
    }
    try {
      const sentinel = await this.host.request('screen');
      sentinel.addEventListener('release', () => {
        this.sentinel = undefined;
        if (this.wanted) this.set('idle');
      });
      this.sentinel = sentinel;
      this.set('held');
    } catch {
      this.set('refused');
    }
  }

  private set(state: WakeLockState): void {
    this.state = state;
    this.onChange(state);
  }
}
