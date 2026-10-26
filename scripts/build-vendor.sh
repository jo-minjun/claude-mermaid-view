#!/usr/bin/env bash
# hooks/vendor/beautiful-mermaid.js 를 다시 만든다.
# mod 모듈은 npm 패키지를 import 할 수 없어서 ASCII 렌더러만 단일 ESM 파일로 번들해 둔다.
# 패키지 진입점(dist)은 SVG용 elkjs(약 1.4MB)까지 끌고 오므로 src/ascii 만 진입점으로 쓴다.
set -euo pipefail

VERSION="${1:-1.1.3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
npm install --silent "beautiful-mermaid@$VERSION"
ENTITIES_VERSION="$(node -p "require('./node_modules/entities/package.json').version")"
echo "export { renderMermaidASCII } from './node_modules/beautiful-mermaid/src/ascii/index.ts'" > entry.ts
bun build entry.ts --target=browser --format=esm --outfile=bundle.js

OUT="$ROOT/hooks/vendor"
{
  echo "// beautiful-mermaid $VERSION (src/ascii) bundled with entities $ENTITIES_VERSION by scripts/build-vendor.sh. Licenses: LICENSE-beautiful-mermaid, LICENSE-entities."
  cat bundle.js
} > "$OUT/beautiful-mermaid.js"
cp node_modules/beautiful-mermaid/LICENSE "$OUT/LICENSE-beautiful-mermaid"
cp node_modules/entities/LICENSE "$OUT/LICENSE-entities"
echo "wrote $OUT/beautiful-mermaid.js"
