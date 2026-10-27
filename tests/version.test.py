"""quiz.lua's dependency version names the site_libs folder (quizkit-<version>).
It must follow _extension.yml, or browsers and caches keep serving the old CSS.

    python3 tests/version.test.py
"""
import re
from pathlib import Path

ext = Path(__file__).resolve().parent.parent / "_extensions" / "quizkit"
want = re.search(r"^version:\s*(\S+)", (ext / "_extension.yml").read_text(), re.M).group(1)
got = re.search(r'version = "([^"]+)"', (ext / "quiz.lua").read_text()).group(1)
assert got == want, f"quiz.lua dependency version {got} != _extension.yml {want}"
print(f"ok: {got}")
