#!/usr/bin/env python3
"""Validate ios/Sideshow.xcodeproj/project.pbxproj structure.
Checks: balanced braces/parens, every referenced object ID exists,
required object types present, every file reference exists on disk,
each target has its build phases, the app embeds the keyboard extension,
and the SPM package references are present. This is a structural check —
it does not replace an Xcode build."""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PBX = os.path.join(HERE, "Sideshow.xcodeproj", "project.pbxproj")
IOS = HERE

errors = []
warnings = []

text = open(PBX).read()

# 1. Balanced braces and parens (ignoring quoted strings).
def strip_strings(s):
    return re.sub(r'"(?:\\.|[^"\\])*"', '""', s)
clean = strip_strings(text)
for a, b, name in (("{", "}", "braces"), ("(", ")", "parens")):
    if clean.count(a) != clean.count(b):
        errors.append(f"unbalanced {name}: {clean.count(a)} '{a}' vs {clean.count(b)} '{b}'")

# 2. Parse objects: ID = { isa = TYPE; ... };
obj_re = re.compile(r"^\t\t([0-9A-F]{24}) = \{\n\t\t\tisa = ([A-Za-z]+);", re.M)
objects = {}
for m in obj_re.finditer(text):
    objects[m.group(1)] = m.group(2)
if not objects:
    errors.append("no objects parsed")
# Duplicate IDs?
ids = re.findall(r"^\t\t([0-9A-F]{24}) = \{", text, re.M)
if len(ids) != len(set(ids)):
    errors.append("duplicate object IDs")

# 3. Every referenced ID exists.
ref_re = re.compile(r"\b([0-9A-F]{24})\b")
referenced = set(ref_re.findall(text))
# IDs that appear as keys are definitions; references are all occurrences.
# An ID is dangling if it is referenced but never defined.
defined = set(objects.keys())
dangling = referenced - defined
if dangling:
    errors.append(f"dangling object references: {sorted(dangling)}")

# 4. rootObject is a PBXProject.
m = re.search(r"rootObject = ([0-9A-F]{24});", text)
if not m:
    errors.append("no rootObject")
elif objects.get(m.group(1)) != "PBXProject":
    errors.append("rootObject is not a PBXProject")

# 5. Required types and counts.
from collections import Counter
counts = Counter(objects.values())
need = {
    "PBXProject": 1,
    "PBXNativeTarget": 2,
    "PBXSourcesBuildPhase": 2,
    "PBXResourcesBuildPhase": 2,
    "PBXFrameworksBuildPhase": 2,
    "PBXCopyFilesBuildPhase": 1,
    "PBXTargetDependency": 1,
    "XCRemoteSwiftPackageReference": 2,
    "XCSwiftPackageProductDependency": 3,
    "XCBuildConfiguration": 6,
    "XCConfigurationList": 3,
}
for isa, n in need.items():
    if counts.get(isa, 0) != n:
        errors.append(f"{isa}: expected {n}, found {counts.get(isa, 0)}")

# 6. Every PBXFileReference path exists on disk (except built products).
for m in re.finditer(r"isa = PBXFileReference;.*?path = ([^;]+);", text, re.S):
    p = m.group(1).strip().strip('"')
    if p in ("Sideshow.app", "SideshowKeyboard.appex"):
        continue
    full = os.path.join(IOS, p)
    if not os.path.exists(full):
        errors.append(f"file reference missing on disk: {p}")
    # sourceTree check
    seg = text[m.start():m.start() + 400]
    if "sourceTree" not in seg:
        warnings.append(f"file reference without sourceTree: {p}")

# 7. App target embeds the keyboard extension (CopyFiles phase, dstSubfolderSpec 13).
if "Embed App Extensions" not in text:
    errors.append("no 'Embed App Extensions' phase")
if "dstSubfolderSpec = 13" not in text:
    errors.append("Embed phase missing dstSubfolderSpec 13 (PlugIns)")

# 8. SPM package URLs.
for url in ("https://github.com/firebase/firebase-ios-sdk", "https://github.com/google/GoogleSignIn-iOS"):
    if url not in text:
        errors.append(f"missing SPM package URL: {url}")
for prod in ("FirebaseAuth", "FirebaseFirestore", "GoogleSignIn"):
    if prod not in text:
        errors.append(f"missing SPM product: {prod}")

# 9. Both targets have a productType and a buildConfigurationList.
for name, ptype in (("Sideshow", "com.apple.product-type.application"),
                    ("SideshowKeyboard", "com.apple.product-type.app-extension")):
    if ptype not in text:
        errors.append(f"missing product type {ptype}")
    if name not in text:
        errors.append(f"missing target name {name}")

# 10. Entitlements + App Group + keyboard extension identifiers.
# These live in the entitlements / Info.plist files, not the pbxproj.
ent_app = open(os.path.join(IOS, "Sideshow", "Sideshow.entitlements")).read()
ent_kbd = open(os.path.join(IOS, "SideshowKeyboard", "SideshowKeyboard.entitlements")).read()
kbd_plist = open(os.path.join(IOS, "SideshowKeyboard", "Info.plist")).read()
if "group.com.firedarts.sideshow" not in ent_app or "group.com.firedarts.sideshow" not in ent_kbd:
    errors.append("App Group identifier missing from one of the entitlements files")
if "com.apple.keyboard-service" not in kbd_plist:
    errors.append("keyboard extension point identifier missing from keyboard Info.plist")
if "RequestsOpenAccess" not in kbd_plist:
    errors.append("keyboard RequestsOpenAccess missing from keyboard Info.plist")

print(f"objects: {len(objects)}")
print(f"types: {dict(counts)}")
if warnings:
    print("WARNINGS:")
    for w in warnings:
        print("  -", w)
if errors:
    print("ERRORS:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("pbxproj OK")
