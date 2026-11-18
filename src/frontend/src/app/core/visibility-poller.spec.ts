import { ThrottledAnnouncer, VisibilityPoller } from './visibility-poller';

function fakeDoc(initial: DocumentVisibilityState = 'visible') {
  const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  target.visibilityState = initial;
  return {
    doc: target as unknown as Document,
    set(state: DocumentVisibilityState) {
      target.visibilityState = state;
      target.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

describe('VisibilityPoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks immediately and then every 5s while visible', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const p = new VisibilityPoller(tick, 5000, fakeDoc().doc);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000);
    expect(tick).toHaveBeenCalledTimes(4);
    p.stop();
  });

  it('pauses while hidden and ticks at once when visible again', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const d = fakeDoc();
    const p = new VisibilityPoller(tick, 5000, d.doc);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    d.set('hidden');
    await vi.advanceTimersByTimeAsync(30000);
    expect(tick).toHaveBeenCalledTimes(1);
    d.set('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('does not start polling when the page is hidden at start', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const p = new VisibilityPoller(tick, 5000, fakeDoc('hidden').doc);
    p.start();
    await vi.advanceTimersByTimeAsync(20000);
    expect(tick).not.toHaveBeenCalled();
    p.stop();
  });

  it('stops for good after stop()', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const d = fakeDoc();
    const p = new VisibilityPoller(tick, 5000, d.doc);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.stop();
    d.set('visible');
    await vi.advanceTimersByTimeAsync(20000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('keeps polling after a failed tick', async () => {
    const tick = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    const p = new VisibilityPoller(tick, 5000, fakeDoc().doc);
    p.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(2);
    p.stop();
  });
});

describe('ThrottledAnnouncer', () => {
  it('announces the first summary at once', () => {
    expect(new ThrottledAnnouncer(30000).offer('א', 0)).toBe('א');
  });

  it('announces at most once every 30s', () => {
    const a = new ThrottledAnnouncer(30000);
    a.offer('א', 0);
    expect(a.offer('ב', 5000)).toBeNull();
    expect(a.offer('ג', 29999)).toBeNull();
    expect(a.offer('ד', 30000)).toBe('ד');
  });

  it('does not repeat an unchanged summary', () => {
    const a = new ThrottledAnnouncer(30000);
    a.offer('א', 0);
    expect(a.offer('א', 60000)).toBeNull();
  });
});
