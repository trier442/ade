from __future__ import annotations

import argparse
import json
from pathlib import Path

from huggingface_hub import snapshot_download


def main() -> int:
    parser = argparse.ArgumentParser(description="Download an ADE Faster-Whisper model pack")
    parser.add_argument("--repo", default="Systran/faster-whisper-large-v3")
    parser.add_argument("--output", required=True)
    parser.add_argument("--revision", default="main")
    args = parser.parse_args()

    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    path = snapshot_download(
        repo_id=args.repo,
        revision=args.revision,
        local_dir=str(output),
    )
    manifest = {
        "engine": "faster-whisper",
        "repository": args.repo,
        "revision": args.revision,
        "path": str(Path(path).resolve()),
    }
    (output / "ade-model.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
