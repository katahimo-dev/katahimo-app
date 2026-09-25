import type { MirrorPort } from '@katahimo/core/ports';

/**
 * MIRROR_TO_GOOGLE_SHEETS=false(スプレッドシート脱却後)のフォールバック。
 * outboxへの積み込み自体を行わない(ミラーワーカーを止めるだけでなくAPI側から止めることで、
 * 処理されないジョブがoutbox_jobsに溜まり続けるのを防ぐ)。
 */
export class NoopMirrorPort implements MirrorPort {
  async enqueue(): Promise<void> {}
}
