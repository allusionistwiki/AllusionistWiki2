#!/usr/bin/env python3
"""
fetch_recent_commits.py — GitHub API から vault（Obsidian）の直近コミットを取得し、
content/recent-commits.md を生成する。CI（deploy.yml）でビルド前に実行する。

- 認証不要（公開リポジトリの API・レート制限 60 回/時/IP）
- 直近 N 件（既定 100 件）を Markdown テーブルとして出力
- 日時は JST に変換
"""
import json
import sys
import urllib.request
import datetime

REPO = "allusionistwiki/AllusionistLLMWiki2_Obsidian"
OUT = "content/recent-commits.md"
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 100

def esc(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ")

def main():
    url = f"https://api.github.com/repos/{REPO}/commits?per_page={LIMIT}"
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "quartz-ci"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        commits = json.load(r)

    lines = [
        "---",
        "title: 直近コミット",
        "description: vault（Obsidian）の直近のコミット（自動生成）",
        "---",
        "",
        "# 直近コミット",
        "",
        f"vault（Obsidian）の直近のコミット {len(commits)} 件です（自動生成・GitHub API から取得）。",
        "",
        "| 日時 (JST) | コミット | メッセージ |",
        "|---|---|---|",
    ]
    for c in commits:
        sha = c["sha"]
        date = c["commit"]["author"]["date"]
        dt = datetime.datetime.fromisoformat(date.replace("Z", "+00:00"))
        jst = dt.astimezone(datetime.timezone(datetime.timedelta(hours=9)))
        date_str = jst.strftime("%Y-%m-%d %H:%M")
        msg = esc(c["commit"]["message"].split("\n")[0])
        lines.append(
            f"| {date_str} | [{sha[:7]}](https://github.com/{REPO}/commit/{sha}) | {msg} |"
        )

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote {OUT} with {len(commits)} commits")

if __name__ == "__main__":
    main()
