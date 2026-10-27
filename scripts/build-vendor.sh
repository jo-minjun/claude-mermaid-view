#!/usr/bin/env bash
# hooks/vendor/beautiful-mermaid.js 를 다시 만든다.
# mod 모듈은 npm 패키지를 import 할 수 없어서 ASCII 렌더러만 단일 ESM 파일로 번들해 둔다.
# 패키지 진입점(dist)은 SVG용 elkjs(약 1.4MB)까지 끌고 오므로 src/ascii 만 진입점으로 쓴다.
# scripts/patches/*.patch 는 렌더러 버그 수정이라 번들 전에 패키지 소스에 적용한다.
set -euo pipefail

VERSION="${1:-1.1.3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
npm install --silent "beautiful-mermaid@$VERSION"
for PATCH in "$ROOT"/scripts/patches/*.patch; do
  patch --silent -p1 -d node_modules/beautiful-mermaid < "$PATCH"
done
echo "export { renderMermaidASCII } from './node_modules/beautiful-mermaid/src/ascii/index.ts'" > entry.ts
bun build entry.ts --target=browser --format=esm --outfile=bundle.js

# 다른 패키지가 번들에 섞이면 그 라이선스도 hooks/vendor/ 에 두어야 하므로 멈춘다
OTHERS="$(grep -o '^// node_modules/[^/]*' bundle.js | sort -u | grep -v '/beautiful-mermaid$' || true)"
if [ -n "$OTHERS" ]; then
  echo "beautiful-mermaid 외 패키지가 번들에 들어갔다. 라이선스 파일과 README를 갱신하고 이 검사를 고쳐라:" >&2
  echo "$OTHERS" >&2
  exit 1
fi

OUT="$ROOT/hooks/vendor"
{
  echo "// beautiful-mermaid $VERSION (src/ascii, with scripts/patches applied) bundled by scripts/build-vendor.sh. License: LICENSE-beautiful-mermaid."
  cat bundle.js
} > "$OUT/beautiful-mermaid.js"
cp node_modules/beautiful-mermaid/LICENSE "$OUT/LICENSE-beautiful-mermaid"
echo "wrote $OUT/beautiful-mermaid.js"
