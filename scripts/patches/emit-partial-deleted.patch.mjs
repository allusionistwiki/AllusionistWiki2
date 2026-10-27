/** Patch 2/2: processors/emit.ts の partialEmit 呼びに `deleted: false` を渡す
 *
 * Quartz の partialEmit は `emit(ctx, toEmit, opts)` を呼ぶ。標準 emitter
 * （emitFile 系）の opts.deleted は既定 true で、`opts.deleted && file.startsWith(".")`
 * のガードにより content 直下ファイル（content/index.md → output/index.html など）が
 * emit されない。差分ビルドで changed 集合へ partialEmit するときにこの既定値が
 * 効くと入口ページ（サイトトップ）が更新されない。呼び出し側で明示的に
 * `deleted: false` を渡して解消する（差分ビルドで消えたページは
 * quartz-diff-build.mjs 側で manifest から削除し、ページ削除は CI の git 差分検知で
 * フルビルドにフォールバックするため、deleted 扱いの削除動作には依存しない）。
 */
export function patchText(src, path = "quartz/processors/emit.ts") {
  const old = `await emitter.partialEmit(ctx, toEmit)`;
  const neu = `await emitter.partialEmit(ctx, toEmit, { deleted: false })`;
  const hits = src.split(old).length - 1;
  if (hits !== 1) {
    throw new Error(`${path}: partialEmit call expected exactly once, found ${hits}`);
  }
  return src.replace(old, neu);
}
