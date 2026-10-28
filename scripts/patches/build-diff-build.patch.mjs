/** Patch v2: build.ts を「差分 LLM パース + 全数 emit」の差分デプロイにする
 * （v1 の QUARTZ_DIFF partialEmit 設計を置き換える — 2026-10-28）
 *
 * 動機: ビルドの 10 分の内訳は parse 6 分（LLM 注記生成が全 32k ページ走る）
 * + emit 5 分。差分デプロイの意味は「変更 .md だけ LLM パース」にある。
 * v1 設計（watch re-parse 経路 + partialEmit）は parse が全数のままだったので、
 * それを置き換える。
 *
 * 発火: QUARTZ_DIFF=1 かつ QUARTZ_PREV_MANIFEST（前回 manifest v2:
 *   { manifestVersion: 2, pages: { <content相対mdパス>: sha256 } }）が存在するとき。
 *   通常ビルド / dev / watch は従来の全数経路のまま（無影響）。
 *
 * 手順:
 *  1. 現 content の .md 各ファイルを sha256 化し manifest と比較 → changed。
 *  2. parseMarkdown は changed だけ（LLM は changed 分だけ走る）。
 *  3. 前回の processed キャッシュ（.quartz-cache/processed.jsonl.gz —
 *     {rel, value, data} 全ページの gzip JSON）から未変更ページを復元して合流。
 *  4. filterContent → emitContent は全数（出力は完全な整合状態になる —
 *     backlinks/graph/searchindex も毎回最新。partialEmit 設計の陈旧問題を排除）。
 *  5. emit 成功后に manifest v2（sha マップ）と processed キャッシュを書く。
 *
 * 前提（CI 側の gate・scripts/diff_gate.py v2）:
 *  - ページ削除・移動がある場合は manifest の prev rel 集合と content の差分で
 *    検知して CI がフルビルドへ逃がす（キャッシュ復元済み vfile の削除連動
 *    backlinks 除去を diff パースで保証しないため）。
 *  - エンジン/ワークフロー/生成スクリプト変更も CI gate でフルビルド。
 *
 * 計算時間の実感: 変更 0 → LLM 0・manifest 一致・全数 emit（~5 分）で公開は
 * 同一。変更 N ページ → LLM は N 件分 + 全数 emit。self-hosted/hosted ランナー
 * の待ち行列そのものは短縮しない。
 */
const PATCH = {
  imports: {
    oldString: `import { existsSync, readFileSync, writeFileSync } from "node:fs"`,
    newString: `import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, createWriteStream } from "node:fs"
import { createHash } from "crypto"
import { createGzip, createGunzip } from "node:zlib"
import { createInterface } from "node:readline"
import rfdc from "rfdc"`,
  },
  diffFlow: {
    oldString: `  const parsedFiles = diffMode
    ? await parseAllForDiff(ctx, filePaths)
    : await parseMarkdown(ctx, filePaths)
  const filteredContent = filterContent(ctx, parsedFiles)

  if (diffMode) {
    await runDiffEmit(ctx, filteredContent)
  } else {
    await emitContent(ctx, filteredContent)
    writeManifest(ctx, filteredContent)
  }`,
    newString: `  const parsedFiles = diffMode
    ? await parseIncremental(ctx, filePaths)
    : await parseMarkdown(ctx, filePaths)
  const filteredContent = filterContent(ctx, parsedFiles)

  await emitContent(ctx, filteredContent)
  await writeDiffState(ctx, filteredContent)`,
  },
  diffImpl: {
    oldString: `// CI 差分ビルド専用の parse 経路: watch 用の re-parse（rebuild と同じ入力形）を
// 一度だけ行う。rebuild は emit まで走るが出力は保持されているので実害はない
// （full emit 相当のコストはかかる — 差分の本体は「公開差分の缩小」である）。
async function parseAllForDiff(ctx: BuildCtx, filePaths: FilePath[]) {
  const changesSinceLastBuild: Record<FilePath, ChangeEvent["type"]> = {}
  for (const fp of filePaths) {
    changesSinceLastBuild[fp] = "change"
  }
  const buildData: BuildData = {
    ctx,
    contentMap: new Map(),
    changesSinceLastBuild,
    mut: new Mutex(),
    lastBuildMs: 0,
  }
  await rebuild([], () => {}, buildData)
  const processed: ProcessedContent[] = []
  for (const entry of buildData.contentMap.values()) {
    if (entry.type === "markdown") processed.push(entry.content)
  }
  return processed
}

// CI 差分ビルドの manifest（frontmatter スナップショット）。
// 通常ビルドでも書く（次回の差分ビルドの基準になる）。
function writeManifest(ctx: BuildCtx, filteredContent: ProcessedContent[]) {
  const manifestPath = joinSegments(ctx.argv.output, "index.json") as FilePath
  const cur: Record<string, unknown> = {}
  for (const content of filteredContent) {
    cur[content[1].data.slug!] = content[1].data
  }
  writeFileSync(manifestPath, JSON.stringify({ frontmatter: cur }))
}

// manifest 差分ビルド（CI 用・QUARTZ_DIFF=1 のときだけ呼ばれる）
async function runDiffEmit(ctx: BuildCtx, filteredContent: ProcessedContent[]) {
  const prevRaw = JSON.parse(readFileSync(process.env.QUARTZ_PREV_MANIFEST!, "utf8"))
  const prev: Record<string, unknown> = prevRaw?.frontmatter ?? {}

  writeManifest(ctx, filteredContent)

  const changed: ProcessedContent[] = []
  for (const content of filteredContent) {
    const slug = content[1].data.slug!
    if (!prev[slug] || JSON.stringify(prev[slug]) !== JSON.stringify(content[1].data)) {
      changed.push(content)
    }
  }
  console.log(\`diff: total=\${Object.keys(cur).length} changed=\${changed.length}\`)

  if (changed.length === 0) {
    console.log("No content changes — nothing to emit (diff build)")
    return
  }

  const staticResources = getStaticResourcesFromPlugins(ctx)
  let emittedFiles = 0
  for (const emitter of ctx.cfg.plugins.emitters) {
    if (!emitter.partialEmit) {
      console.log(\`diff: skipping emitter \${emitter.name} (no partialEmit)\`)
      continue
    }
    // deleted:false 明示 — 既定 true だと emitFile のガードで content 直下の
    // ページ（サイトトップ index.html 等）が emit されない。
    const emitted = await emitter.partialEmit(ctx, changed, staticResources, [], {
      deleted: false,
    })
    if (emitted === null) continue
    if (Symbol.asyncIterator in emitted) {
      for await (const _f of emitted) emittedFiles++
    } else {
      emittedFiles += emitted.length
    }
  }
  console.log(\`DIFF-EMIT done: emitted=\${emittedFiles} changed=\${changed.length}\`)
}`,
    newString: `// CI 差分ビルド（QUARTZ_DIFF=1 のときだけ）: manifest の sha256 と比べ、
// 変更された .md だけ parse（LLM）し、未変更ページは processed キャッシュから
// 復元して合流する。emit は全数（出力は完全一致・graph/search も毎回最新）。
const DIFF_PAGES: Record<string, string> = {}

function relOf(ctx: BuildCtx, fp: FilePath): string {
  return path.relative(ctx.argv.directory, fp).split(path.sep).join("/")
}

async function parseIncremental(ctx: BuildCtx, filePaths: FilePath[]) {
  const { argv } = ctx
  const prevRaw = JSON.parse(readFileSync(process.env.QUARTZ_PREV_MANIFEST!, "utf8"))
  const prevPages: Record<string, string> = prevRaw?.pages ?? {}
  if (prevRaw?.manifestVersion !== 2) {
    throw new Error("diff build: prev manifest is not manifestVersion 2 — full build required")
  }

  const changedPaths: FilePath[] = []
  const changedRels = new Set<string>()
  for (const fp of filePaths) {
    const rel = relOf(ctx, fp)
    const hash = createHash("sha256").update(readFileSync(fp)).digest("hex")
    DIFF_PAGES[rel] = hash
    if (prevPages[rel] !== hash) {
      changedPaths.push(fp)
      changedRels.add(rel)
    }
  }
  console.log(\`diff: pages=\${filePaths.length} llm-parse=\${changedPaths.length}\`)

  const parsedNew = await parseMarkdown(ctx, changedPaths)

  const cachePath = process.env.QUARTZ_PROCESSED_CACHE ?? ".quartz-cache/processed.jsonl.gz"
  if (!existsSync(cachePath)) {
    throw new Error(\`diff build: processed cache missing at \${cachePath} — full build required\`)
  }
  // processed スナップショットは JSONL（1 ページ 1 行 gzip）なのでストリームで
  // 1 行ずつパースする（JSON.parse 単発は V8 の 512MB 文字列/バッファ上限に当たる）。
  const cached: { pages?: any[] } = { pages: [] }
  {
    const rl = createInterface({
      input: createReadStream(cachePath).pipe(createGunzip()),
      crlfDelay: Infinity,
    })
    for await (const line of rl) {
      if (line.trim() === "") continue
      cached.pages!.push(JSON.parse(line))
    }
  }
  const DATE_KEYS = ["date", "modified", "published", "created"]
  const merged: ProcessedContent[] = [...parsedNew]
  for (const e of cached.pages ?? []) {
    if (changedRels.has(e.rel)) continue
    // 未変更ページは前回の processed（frontmatter・HTML・tree 込みの data）を
    // そのまま使う — parse は二度と同じ結果になるため LLM を走らせない。
    // JSON 往復で Date に化けた日付フィールドを復元する（contentIndex 等の
    // toISOString 呼び出しが Date を前提にするため）。CreatedModifiedDate が
    // 書き込む data.dates.{created,modified,published} と top-level 日付の両方。
    for (const k of DATE_KEYS) {
      if (typeof e.data?.[k] === "string") {
        e.data[k] = new Date(e.data[k])
      }
    }
    if (e.data?.dates) {
      for (const k of ["created", "modified", "published"]) {
        if (typeof e.data.dates[k] === "string") {
          e.data.dates[k] = new Date(e.data.dates[k])
        }
      }
    }
    const clone: any = rfdc()
    const root: any = clone(e.data.htmlAst)
    root.type = "root"
    const vfile: any = {
      value: e.value,
      data: e.data,
      messages: [],
    }
    vfile.data.tree = root
    merged.push([root, vfile] as unknown as ProcessedContent)
  }
  console.log(\`diff: restored=\${merged.length - parsedNew.length} parsed=\${parsedNew.length}\`)
  return merged
}

// 差分状態（manifest v2 + processed キャッシュ）を emit 後に更新する。
// 通常（フル）ビルドでも呼ばれる — 次回の差分ビルドの基準（キャッシュ）を
// 暖める。差分モードでは parseIncremental が計算した sha マップをそのまま使う。
// 途中失敗で書かれなくても次回の差分計算は安全（変更は再検出される）。
async function writeDiffState(ctx: BuildCtx, filteredContent: ProcessedContent[]) {
  const { argv } = ctx
  if (Object.keys(DIFF_PAGES).length === 0) {
    for (const rel0 of ctx.allFiles) {
      if (!rel0.endsWith(".md")) continue
      const rel = rel0.split("\\\\").join("/")
      DIFF_PAGES[rel] = createHash("sha256").update(readFileSync(joinSegments(argv.directory, rel0))).digest("hex")
    }
  }
  const manifestPath = joinSegments(argv.output, "index.json") as FilePath
  writeFileSync(manifestPath, JSON.stringify({ manifestVersion: 2, pages: DIFF_PAGES }))

  const cachePath = process.env.QUARTZ_PROCESSED_CACHE ?? ".quartz-cache/processed.jsonl.gz"
  // processed スナップショットは JSONL（1 ページ 1 行）で書く。単発 JSON.stringify は
  // 全ページの AST で V8 の文字列上限（約 512MB）を超えるためストリームで出力する。
  mkdirSync(path.dirname(cachePath), { recursive: true })
  const out = createWriteStream(cachePath)
  const gz = createGzip()
  gz.pipe(out)
  for (const content of filteredContent) {
    const vf = content[1]
    gz.write(JSON.stringify({ rel: vf.data.relativePath, value: String(vf.value), data: vf.data }) + "\\n")
  }
  await new Promise<void>((resolve, reject) => {
    gz.on("error", reject)
    out.on("error", reject)
    out.on("finish", resolve)
    gz.end()
  })
  console.log(\`diff: state written pages=\${filteredContent.length}\`)
}`,
  },
}

/** 石英エンジンへ差分デプロイの patch を適用する（冪等）。 */
export function patchText(src, path = "quartz/build.ts") {
  const parts = Object.keys(PATCH)
  const has = (p) => src.includes(PATCH[p].newString)
  const hasOld = (p) => src.includes(PATCH[p].oldString)
  if (parts.every(has)) return src
  if (!parts.every(hasOld)) {
    const problems = parts
      .filter((p) => !has(p) && !hasOld(p))
      .map((p) => `${path}: patch part '${p}' matches neither old nor new block`)
    throw new Error(problems.join("\n"))
  }
  for (const p of parts) {
    src = src.replace(PATCH[p].oldString, PATCH[p].newString)
  }
  return src
}
