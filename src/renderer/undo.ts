// 再生成の直前状態を一世代だけ保持する。新しい再生成は古いUndo対象を置き換える。
export class OneLevelUndo<T> {
  private value: T | null = null;

  capture(value: T): void {
    this.value = value;
  }

  take(): T | null {
    const value = this.value;
    this.value = null;
    return value;
  }

  clear(): void {
    this.value = null;
  }
}
