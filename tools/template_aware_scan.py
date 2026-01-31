#!/usr/bin/env python3
import os, re, json

ROOT = os.path.join(os.getcwd(), 'trading-dashboard', 'src')
APP_ROOT = os.path.join(ROOT, 'app')

method_decl_re = re.compile(r'^[ \t]*(?:public |private |protected |static |async |readonly )*(?:get |set )?([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{', re.M)
arrow_assign_re = re.compile(r'(^|\s)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\([^)]*\)\s*=>', re.M)
func_decl_re = re.compile(r'^[ \t]*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(', re.M)
export_func_re = re.compile(r'^[ \t]*export\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(', re.M)

# Angular lifecycle hooks to ignore
LIFECYCLE = set(["ngOnInit","ngAfterViewInit","ngOnDestroy","ngOnChanges","ngDoCheck","ngAfterContentInit","ngAfterContentChecked","ngAfterViewChecked","ngOnInit","ngOnDestroy"])

# Common JS/TS keywords to ignore when mis-detected as identifiers
KEYWORDS = set(["if","for","while","switch","catch","return","case","else","do","try","finally","break","continue","throw","new"])

candidates = []

for dirpath, dirnames, filenames in os.walk(APP_ROOT):
    for fn in filenames:
        if not fn.endswith('.ts'):
            continue
        path = os.path.join(dirpath, fn)
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            text = f.read()
        # method declarations
        for m in method_decl_re.finditer(text):
            name = m.group(1)
            if name in LIFECYCLE or name == 'constructor' or name in KEYWORDS:
                continue
            line = text.count('\n', 0, m.start()) + 1
            candidates.append({'name': name, 'file': os.path.relpath(path), 'line': line})
        # arrow assigns
        for m in arrow_assign_re.finditer(text):
            name = m.group(2)
            if name in KEYWORDS:
                continue
            line = text.count('\n', 0, m.start()) + 1
            candidates.append({'name': name, 'file': os.path.relpath(path), 'line': line})
        # free functions
        for m in export_func_re.finditer(text):
            name = m.group(1)
            line = text.count('\n', 0, m.start()) + 1
            candidates.append({'name': name, 'file': os.path.relpath(path), 'line': line})
        for m in func_decl_re.finditer(text):
            name = m.group(1)
            line = text.count('\n', 0, m.start()) + 1
            candidates.append({'name': name, 'file': os.path.relpath(path), 'line': line})

# Deduplicate by (name,file,line)
seen = set()
uniq = []
for c in candidates:
    key = (c['name'], c['file'], c['line'])
    if key in seen:
        continue
    seen.add(key)
    uniq.append(c)

# search files for usages
all_files = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    for fn in filenames:
        if fn.endswith('.ts') or fn.endswith('.html'):
            all_files.append(os.path.join(dirpath, fn))

results = []
word_cache = {}

for c in uniq:
    name = c['name']
    pattern = re.compile(r'\b' + re.escape(name) + r'\b')
    matches = []
    for path in all_files:
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                text = f.read()
        except Exception:
            continue
        for m in pattern.finditer(text):
            line = text.count('\n', 0, m.start()) + 1
            matches.append({'file': os.path.relpath(path), 'line': line})
    # filter out the declaration itself
    filtered = [m for m in matches if not (m['file'] == c['file'] and m['line'] == c['line'])]
    results.append({'name': name, 'declaration': c, 'occurrences': filtered, 'total_matches': len(matches)})

# collect likely unused: zero occurrences
unused = [r for r in results if len(r['occurrences']) == 0]

print(json.dumps({'summary':{'candidates': len(uniq),'scanned_files': len(all_files),'unused_count': len(unused)}, 'unused': unused}, indent=2))
