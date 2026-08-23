#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "components" / "player" / "PlayerChrome.tsx"
text = path.read_text(encoding="utf-8")
text = text.replace("const initializedPlayers = new WeakSet<Function>();\n", "", 1)
text = text.replace(
    '''  useEffect(() => {\n    const cycle = props.onCycleFit as unknown as Function;\n    if (initializedPlayers.has(cycle)) return;\n    initializedPlayers.add(cycle);\n    if (props.fitMode === "fit") {\n      props.onCycleFit();\n      props.onCycleFit();\n    }\n  }, [props.fitMode, props.onCycleFit]);\n\n''',
    "",
    1,
)
if "initializedPlayers" in text or "useEffect(() =>" in text:
    raise SystemExit("Legacy player auto-cycle block still present")
path.write_text(text, encoding="utf-8")
print("Removed legacy automatic fit-mode cycling")
