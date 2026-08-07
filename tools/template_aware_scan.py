#!/usr/bin/env python3

import json
import re
from datetime import datetime
from pathlib import Path


# ============================================================
# CONFIG
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

ANGULAR_ROOT = PROJECT_ROOT / "trading-dashboard"
SRC_ROOT = ANGULAR_ROOT / "src"

# OUTPUT_FILE = PROJECT_ROOT / "tools" / "code-audit-report.json"
# OUTPUT_FILE = ( PROJECT_ROOT / "trading-dashboard"/ "public"/ "code-audit-report.json")
OUTPUT_FILE = (PROJECT_ROOT/ "trading-dashboard"/ "public"/ "tools"/ "code-audit-report.json")
# OUTPUT_FILE = (ANGULAR_ROOT/ "src"/ "assets"/ "tools"/ "code-audit-report.json")

SCANNER_VERSION = "2.1.0"


TS_EXTENSIONS = {".ts"}
HTML_EXTENSIONS = {".html"}
STYLE_EXTENSIONS = {".scss", ".css"}


LIFECYCLE_METHODS = {
    "ngOnChanges",
    "ngOnInit",
    "ngDoCheck",
    "ngAfterContentInit",
    "ngAfterContentChecked",
    "ngAfterViewInit",
    "ngAfterViewChecked",
    "ngOnDestroy",
}


KEYWORDS = {
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "case",
    "else",
    "do",
    "try",
    "finally",
    "break",
    "continue",
    "throw",
    "new",
    "typeof",
    "instanceof",
    "delete",
    "void",
    "in",
    "of",
}


# ============================================================
# REGEX
# ============================================================

METHOD_RE = re.compile(
    r"""
    ^[ \t]*
    (?:
        public\s+|
        private\s+|
        protected\s+|
        static\s+|
        async\s+|
        readonly\s+
    )*
    (?:
        get\s+|
        set\s+
    )?
    ([A-Za-z_$][A-Za-z0-9_$]*)
    \s*
    \(
    """,
    re.MULTILINE | re.VERBOSE,
)


ARROW_FUNCTION_RE = re.compile(
    r"""
    (?:
        const\s+|
        let\s+|
        var\s+|
    )?
    ([A-Za-z_$][A-Za-z0-9_$]*)
    \s*=\s*
    (?:async\s+)?
    \([^)]*\)
    \s*=>
    """,
    re.VERBOSE,
)


FUNCTION_RE = re.compile(
    r"""
    ^[ \t]*
    (?:
        export\s+
    )?
    function\s+
    ([A-Za-z_$][A-Za-z0-9_$]*)
    \s*\(
    """,
    re.MULTILINE | re.VERBOSE,
)


COMPONENT_SELECTOR_RE = re.compile(
    r"""
    selector\s*:\s*
    ['"]([^'"]+)['"]
    """,
    re.VERBOSE,
)


CSS_CLASS_RE = re.compile(
    r"""
    (?<![A-Za-z0-9_-])
    \.([A-Za-z_][A-Za-z0-9_-]*)
    """,
    re.VERBOSE,
)


CSS_ID_RE = re.compile(
    r"""
    \#([A-Za-z_][A-Za-z0-9_-]*)
    """,
    re.VERBOSE,
)


HOST_LISTENER_RE = re.compile(
    r"""
    @HostListener
    \s*\(
    \s*(?P<quote>['"])(?P<event>[^'"]+)(?P=quote)
    [\s\S]*?
    \)
    \s*
    (?:(?:public|private|protected|static|async|readonly)\s+)*
    (?P<name>[A-Za-z_$][A-Za-z0-9_$]*)
    \s*\(
    """,
    re.VERBOSE,
)


# ============================================================
# HELPERS
# ============================================================

def relative_path(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT)).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


def read_file(path: Path) -> str:
    try:
        return path.read_text(
            encoding="utf-8",
            errors="ignore"
        )
    except Exception:
        return ""


def line_number(text: str, position: int) -> int:
    return text.count("\n", 0, position) + 1


def collect_files():
    if not SRC_ROOT.exists():
        print(f"ERROR: Source directory not found:")
        print(f"  {SRC_ROOT}")
        raise SystemExit(1)

    files = []

    for path in SRC_ROOT.rglob("*"):

        if not path.is_file():
            continue

        if path.suffix.lower() in (
            TS_EXTENSIONS
            | HTML_EXTENSIONS
            | STYLE_EXTENSIONS
        ):
            files.append(path)

    return files


def add_unique(items, item, key):
    if key not in {key(x) for x in items}:
        items.append(item)


# ============================================================
# COLLECT FILES
# ============================================================

all_files = collect_files()

ts_files = [
    p for p in all_files
    if p.suffix.lower() in TS_EXTENSIONS
]

html_files = [
    p for p in all_files
    if p.suffix.lower() in HTML_EXTENSIONS
]

style_files = [
    p for p in all_files
    if p.suffix.lower() in STYLE_EXTENSIONS
]


contents = {
    path: read_file(path)
    for path in all_files
}


# ============================================================
# FUNCTIONS
# ============================================================

functions = []
host_listeners = {}


for path in ts_files:

    text = contents[path]
    rel = relative_path(path)

    for match in HOST_LISTENER_RE.finditer(text):
        host_listeners[(rel, match.group("name"), line_number(text, match.start("name")))] = match.group("event")


def register_function(name, path, line, kind):

    if not name or name in KEYWORDS:
        return

    rel = relative_path(path)

    if name in LIFECYCLE_METHODS:
        kind = "lifecycle-hook"
    elif (rel, name, line) in host_listeners:
        kind = "host-listener"

    functions.append({
        "name": name,
        "file": rel,
        "line": line,
        "kind": kind,
    })


for path in ts_files:

    text = contents[path]

    for match in METHOD_RE.finditer(text):

        name = match.group(1)

        if name == "constructor":
            continue

        register_function(
            name,
            path,
            line_number(text, match.start()),
            "method",
        )

    for match in ARROW_FUNCTION_RE.finditer(text):

        register_function(
            match.group(1),
            path,
            line_number(text, match.start()),
            "arrow-function",
        )

    for match in FUNCTION_RE.finditer(text):

        register_function(
            match.group(1),
            path,
            line_number(text, match.start()),
            "function",
        )


unique_functions = []
seen_functions = set()

for function in functions:

    key = (
        function["name"],
        function["file"],
        function["line"],
    )

    if key in seen_functions:
        continue

    seen_functions.add(key)
    unique_functions.append(function)


# ============================================================
# FUNCTION REFERENCES
# ============================================================

def line_text_at(text, position):
    start = text.rfind("\n", 0, position) + 1
    end = text.find("\n", position)
    return text[start:] if end == -1 else text[start:end]


def template_reference_context(text, position):
    line = line_text_at(text, position)
    before = line[:position - (text.rfind("\n", 0, position) + 1)]

    if re.search(r"@\s*(?:if|for|switch|defer)\s*\([^)]*$", before):
        return "Angular control flow"
    if "{{" in before and "}}" not in before:
        return "template interpolation"
    if re.search(r"\[\([^\]]+\)\]\s*=\s*['\"][^'\"]*$", before):
        return "template two-way binding"
    if re.search(r"\([^)]*\)\s*=\s*['\"][^'\"]*$", before):
        return "template event binding"
    if re.search(r"\[[^\]]+\]\s*=\s*['\"][^'\"]*$", before):
        return "template property binding"
    if re.search(r"\*[A-Za-z-]+\s*=\s*['\"][^'\"]*$", before):
        return "template structural directive"

    return "template expression"


def typescript_reference_context(line, name):
    escaped_name = re.escape(name)

    callback_pattern = (
        r"(?:\(|,)\s*(?:this\.)?" + escaped_name
        + r"\s*(?=,|\))"
    )
    callback_property_pattern = (
        r"\b(?:callback|handler|listener|next|error|complete)\s*:\s*"
        + r"(?:this\.)?" + escaped_name + r"\b"
    )

    if re.search(callback_pattern, line) or re.search(callback_property_pattern, line):
        return "callback reference"
    if re.search(r"(?:this\.)?" + escaped_name + r"\s*\(", line):
        return "TypeScript call"

    return "TypeScript reference"


def add_reference(references, file, line, context):
    add_unique(
        references,
        {"file": file, "line": line, "context": context},
        lambda item: (item["file"], item["line"], item["context"]),
    )


def find_function_references(function):

    name = function["name"]
    pattern = re.compile(r"\b" + re.escape(name) + r"\b")
    references = []

    if function["kind"] == "lifecycle-hook":
        add_reference(
            references,
            function["file"],
            function["line"],
            "Angular lifecycle hook",
        )
    elif function["kind"] == "host-listener":
        event = host_listeners[(function["file"], name, function["line"])]
        add_reference(
            references,
            function["file"],
            function["line"],
            f"Host listener ({event})",
        )

    for path in ts_files + html_files:

        text = contents[path]
        rel = relative_path(path)

        for match in pattern.finditer(text):

            line = line_number(text, match.start())

            if rel == function["file"] and line == function["line"]:
                continue

            context = (
                template_reference_context(text, match.start())
                if path.suffix.lower() in HTML_EXTENSIONS
                else typescript_reference_context(line_text_at(text, match.start()), name)
            )

            add_reference(references, rel, line, context)

    return references


function_results = []

for function in unique_functions:

    references = find_function_references(function)
    status = "unused" if len(references) == 0 else "used"

    function_results.append({
        **function,
        "referenceCount": len(references),
        "status": status,
        "references": references,
    })


# ============================================================
# ANGULAR COMPONENTS
# ============================================================

components = []

for path in ts_files:

    text = contents[path]

    for match in COMPONENT_SELECTOR_RE.finditer(text):

        selector = match.group(1)

        if selector.startswith("["):
            continue

        components.append({
            "selector": selector,
            "file": relative_path(path),
            "line": line_number(
                text,
                match.start()
            ),
        })


component_results = []

for component in components:

    selector = component["selector"]

    pattern = re.compile(
        r"<" + re.escape(selector) + r"\b",
        re.IGNORECASE,
    )

    references = []

    for path in html_files:

        text = contents[path]

        for match in pattern.finditer(text):

            references.append({
                "file": relative_path(path),
                "line": line_number(
                    text,
                    match.start()
                ),
            })

    status = (
        "unused"
        if len(references) == 0
        else "used"
    )

    component_results.append({
        **component,

        "referenceCount": len(references),

        "status": status,

        "references": references,
    })


# ============================================================
# CSS / SCSS
# ============================================================

css_selectors = []

for path in style_files:

    text = contents[path]

    # Classes
    for match in CSS_CLASS_RE.finditer(text):

        css_selectors.append({
            "selector": "." + match.group(1),
            "name": match.group(1),
            "type": "class",
            "file": relative_path(path),
            "line": line_number(
                text,
                match.start()
            ),
        })

    # IDs
    for match in CSS_ID_RE.finditer(text):

        css_selectors.append({
            "selector": "#" + match.group(1),
            "name": match.group(1),
            "type": "id",
            "file": relative_path(path),
            "line": line_number(
                text,
                match.start()
            ),
        })


# Deduplicate CSS
unique_css = []

seen_css = set()

for selector in css_selectors:

    key = (
        selector["selector"],
        selector["file"],
        selector["line"],
    )

    if key in seen_css:
        continue

    seen_css.add(key)
    unique_css.append(selector)


def find_css_references(selector):

    name = selector["name"]

    if selector["type"] == "class":

        pattern = re.compile(
            r"""
            (?:
                class\s*=\s*["'][^"']*
                \b""" + re.escape(name) + r"""\b
                |
                \[class[^]]*\]
                |
                \b""" + re.escape(name) + r"""\b
            )
            """,
            re.VERBOSE,
        )

    else:

        pattern = re.compile(
            r"""
            id\s*=\s*["']
            """ + re.escape(name) + r"""
            ["']
            """,
            re.VERBOSE,
        )

    references = []

    for path in ts_files + html_files:

        text = contents[path]

        for match in pattern.finditer(text):

            references.append({
                "file": relative_path(path),
                "line": line_number(
                    text,
                    match.start()
                ),
            })

    return references


css_results = []

for selector in unique_css:

    references = find_css_references(selector)

    status = (
        "unused"
        if len(references) == 0
        else "used"
    )

    css_results.append({
        **selector,

        "referenceCount": len(references),

        "status": status,

        "references": references,
    })


# ============================================================
# SUMMARY
# ============================================================

unused_functions = [
    x for x in function_results
    if x["status"] == "unused"
]

unused_components = [
    x for x in component_results
    if x["status"] == "unused"
]

unused_css = [
    x for x in css_results
    if x["status"] == "unused"
]


# ============================================================
# HEALTH SCORE
# ============================================================

def calculate_health_score():

    function_score = (
        100
        if not function_results
        else (
            100
            * (
                len(function_results)
                - len(unused_functions)
            )
            / len(function_results)
        )
    )

    component_score = (
        100
        if not component_results
        else (
            100
            * (
                len(component_results)
                - len(unused_components)
            )
            / len(component_results)
        )
    )

    css_score = (
        100
        if not css_results
        else (
            100
            * (
                len(css_results)
                - len(unused_css)
            )
            / len(css_results)
        )
    )

    score = (
        function_score * 0.50
        + component_score * 0.25
        + css_score * 0.25
    )

    return round(score)


health_score = calculate_health_score()


# ============================================================
# JSON REPORT
# ============================================================

report = {

    "meta": {
        "project": ANGULAR_ROOT.name,
        "generatedAt": datetime.now().isoformat(
            timespec="seconds"
        ),
        "scannerVersion": SCANNER_VERSION,
    },

    "summary": {

        "typescriptFiles": len(ts_files),
        "htmlFiles": len(html_files),
        "styleFiles": len(style_files),

        "functionsFound": len(function_results),
        "potentiallyUnusedFunctions": len(
            unused_functions
        ),

        "angularComponentsFound": len(
            component_results
        ),

        "potentiallyUnusedComponents": len(
            unused_components
        ),

        "cssSelectorsFound": len(css_results),

        "potentiallyUnusedCss": len(
            unused_css
        ),

        "healthScore": health_score,
    },

    "functions": function_results,

    "components": component_results,

    "css": css_results,
}


# ============================================================
# WRITE JSON
# ============================================================

OUTPUT_FILE.parent.mkdir(
    parents=True,
    exist_ok=True
)

OUTPUT_FILE.write_text(
    json.dumps(
        report,
        ensure_ascii=False,
        separators=(",", ":")
    ),
    encoding="utf-8"
)


# ============================================================
# CLI SUMMARY
# ============================================================

print()
print("=" * 70)
print(" CODE AUDIT COMPLETE")
print("=" * 70)

print()
print(f"TypeScript files : {len(ts_files)}")
print(f"HTML files       : {len(html_files)}")
print(f"Style files      : {len(style_files)}")

print()
print(f"Functions        : {len(function_results)}")
print(f"Unused functions : {len(unused_functions)}")

print()
print(f"Components       : {len(component_results)}")
print(f"Unused components: {len(unused_components)}")

print()
print(f"CSS selectors    : {len(css_results)}")
print(f"Unused CSS       : {len(unused_css)}")

print()
print(f"Health score     : {health_score}/100")

print()
print(f"Report:")
print(f"  {relative_path(OUTPUT_FILE)}")

print()
print("=" * 70)
