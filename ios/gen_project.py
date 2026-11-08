#!/usr/bin/env python3
"""Generate ios/Sideshow.xcodeproj/project.pbxproj for Sideshow.

Deterministic 24-char hex IDs derived from a stable key, so the file is
reproducible. Validated by tools/validate_pbxproj.py after generation.
"""
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "Sideshow.xcodeproj", "project.pbxproj")

def uid(key):
    return hashlib.md5(key.encode()).hexdigest()[:24].upper()

# ---------- file inventory ----------
# (key, path, lastKnownFileType, buildPhase for each target)
FILES = {
    "app_swift":   ("Sideshow/SideshowApp.swift", "sourcecode.swift"),
    "content_swift": ("Sideshow/ContentView.swift", "sourcecode.swift"),
    "eventstore":  ("Shared/EventStore.swift", "sourcecode.swift"),
    "config_swift": ("Shared/SideshowConfig.swift", "sourcecode.swift"),
    "kbd_swift":   ("SideshowKeyboard/KeyboardViewController.swift", "sourcecode.swift"),
    "app_plist":   ("Sideshow/Info.plist", "text.plist.xml"),
    "app_ent":     ("Sideshow/Sideshow.entitlements", "text.plist.entitlements"),
    "kbd_plist":   ("SideshowKeyboard/Info.plist", "text.plist.xml"),
    "kbd_ent":     ("SideshowKeyboard/SideshowKeyboard.entitlements", "text.plist.entitlements"),
    "assets":      ("Sideshow/Assets.xcassets", "folder.assetcatalog"),
}

APP_SOURCES = ["app_swift", "content_swift", "eventstore", "config_swift"]
KBD_SOURCES = ["kbd_swift", "eventstore", "config_swift"]
APP_RESOURCES = ["assets"]

objects = {}

def add(isa, key, attrs):
    objects[uid(key)] = {"isa": isa, **attrs}
    return uid(key)

def fileref(key):
    path, ftype = FILES[key]
    name = os.path.basename(path)
    attrs = {"lastKnownFileType": ftype, "name": name, "path": path, "sourceTree": "<group>"}
    return add("PBXFileReference", "fileref:" + key, attrs)

def buildfile(key, target):
    fr = fileref(key)
    return add("PBXBuildFile", "buildfile:" + key + ":" + target, {"fileRef": fr})

# ---------- file references ----------
refs = {k: fileref(k) for k in FILES}
# product references (the built app + extension)
app_product = add("PBXFileReference", "fileref:app_product",
                  {"explicitFileType": "wrapper.application", "includeInIndex": 0,
                   "name": "Sideshow.app", "path": "Sideshow.app", "sourceTree": "BUILT_PRODUCTS_DIR"})
kbd_product = add("PBXFileReference", "fileref:kbd_product",
                  {"explicitFileType": "wrapper.app-extension", "includeInIndex": 0,
                   "name": "SideshowKeyboard.appex", "path": "SideshowKeyboard.appex", "sourceTree": "BUILT_PRODUCTS_DIR"})

# ---------- groups ----------
def group(key, children, name=None, path=None):
    attrs = {"children": children, "sourceTree": "<group>"}
    if name: attrs["name"] = name
    if path: attrs["path"] = path
    return add("PBXGroup", "group:" + key, attrs)

g_sideshow = group("sideshow", [refs["app_swift"], refs["content_swift"], refs["app_plist"], refs["app_ent"], refs["assets"]], name="Sideshow", path="Sideshow")
g_kbd = group("kbd", [refs["kbd_swift"], refs["kbd_plist"], refs["kbd_ent"]], name="SideshowKeyboard", path="SideshowKeyboard")
g_shared = group("shared", [refs["eventstore"], refs["config_swift"]], name="Shared", path="Shared")
g_products = group("products", [app_product, kbd_product], name="Products")
g_main = group("main", [g_sideshow, g_kbd, g_shared, g_products])

# ---------- SPM package references ----------
def remote_pkg(key, url, min_version):
    return add("XCRemoteSwiftPackageReference", "pkg:" + key, {
        "repositoryURL": url,
        "requirement": {"kind": "upToNextMajorVersion", "minimumVersion": min_version},
    })

pkg_firebase = remote_pkg("firebase", "https://github.com/firebase/firebase-ios-sdk", "11.0.0")
pkg_googlesignin = remote_pkg("googlesignin", "https://github.com/google/GoogleSignIn-iOS", "8.0.0")

def pkg_product(key, package, product):
    return add("XCSwiftPackageProductDependency", "pkgprod:" + key, {
        "package": package, "productName": product,
    })

prod_auth = pkg_product("auth", pkg_firebase, "FirebaseAuth")
prod_firestore = pkg_product("firestore", pkg_firebase, "FirebaseFirestore")
prod_gsi = pkg_product("gsi", pkg_googlesignin, "GoogleSignIn")

# ---------- build phases ----------
def sources_phase(key, target, file_keys):
    bfs = [buildfile(k, target) for k in file_keys]
    return add("PBXSourcesBuildPhase", "phase:sources:" + target, {
        "buildActionMask": 2147483647, "files": bfs, "runOnlyForDeploymentPostprocessing": 0,
    })

def resources_phase(key, target, file_keys):
    bfs = [buildfile(k, target) for k in file_keys]
    return add("PBXResourcesBuildPhase", "phase:resources:" + target, {
        "buildActionMask": 2147483647, "files": bfs, "runOnlyForDeploymentPostprocessing": 0,
    })

def frameworks_phase(key, target, pkg_products):
    bfs = []
    for pp in pkg_products:
        bfs.append(add("PBXBuildFile", "buildfile:fw:" + pp + ":" + target, {"fileRef": pp}))
    return add("PBXFrameworksBuildPhase", "phase:frameworks:" + target, {
        "buildActionMask": 2147483647, "files": bfs, "runOnlyForDeploymentPostprocessing": 0,
    })

def embed_extensions_phase():
    bf = add("PBXBuildFile", "buildfile:embed:kbd", {
        "fileRef": kbd_product,
        "settings": {"ATTRIBUTES": ["CodeSignOnCopy", "RemoveHeadersOnCopy"]},
    })
    return add("PBXCopyFilesBuildPhase", "phase:embed:app", {
        "buildActionMask": 2147483647,
        "dstPath": "",
        "dstSubfolderSpec": 13,
        "files": [bf],
        "name": "Embed App Extensions",
        "runOnlyForDeploymentPostprocessing": 0,
    })

app_sources = sources_phase("app_sources", "app", APP_SOURCES)
app_resources = resources_phase("app_resources", "app", APP_RESOURCES)
app_frameworks = frameworks_phase("app_fw", "app", [prod_auth, prod_firestore, prod_gsi])
app_embed = embed_extensions_phase()
kbd_sources = sources_phase("kbd_sources", "kbd", KBD_SOURCES)
kbd_resources = resources_phase("kbd_resources", "kbd", [])
kbd_frameworks = frameworks_phase("kbd_fw", "kbd", [])

# ---------- build configurations ----------
def xcconfig(key, name, settings):
    return add("XCBuildConfiguration", "xcconfig:" + key, {
        "buildSettings": settings, "name": name,
    })

def xcconfiglist(key, configs):
    return add("XCConfigurationList", "xcconfiglist:" + key, {
        "buildConfigurations": configs,
        "defaultConfigurationIsVisible": 0,
        "defaultConfigurationName": "Release",
    })

PROJ_DEBUG = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS": "YES",
    "CLANG_ANALYZER_NONNULL": "YES",
    "CLANG_ANALYZER_NUMBER_OBJECT_CONVERSION": "YES_AGGRESSIVE",
    "CLANG_CXX_LANGUAGE_STANDARD": "gnu++20",
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "CLANG_ENABLE_OBJC_WEAK": "YES",
    "CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING": "YES",
    "CLANG_WARN_BOOL_CONVERSION": "YES",
    "CLANG_WARN_COMMA": "YES",
    "CLANG_WARN_CONSTANT_CONVERSION": "YES",
    "CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS": "YES",
    "CLANG_WARN_DIRECT_OBJC_ISA_USAGE": "YES_ERROR",
    "CLANG_WARN_DOCUMENTATION_COMMENTS": "YES",
    "CLANG_WARN_EMPTY_BODY": "YES",
    "CLANG_WARN_ENUM_CONVERSION": "YES",
    "CLANG_WARN_INFINITE_RECURSION": "YES",
    "CLANG_WARN_INT_CONVERSION": "YES",
    "CLANG_WARN_NON_LITERAL_NULL_CONVERSION": "YES",
    "CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF": "YES",
    "CLANG_WARN_OBJC_LITERAL_CONVERSION": "YES",
    "CLANG_WARN_OBJC_ROOT_CLASS": "YES_ERROR",
    "CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER": "YES",
    "CLANG_WARN_RANGE_LOOP_ANALYSIS": "YES",
    "CLANG_WARN_STRICT_PROTOTYPES": "YES",
    "CLANG_WARN_SUSPICIOUS_MOVE": "YES",
    "CLANG_WARN_UNGUARDED_AVAILABILITY": "YES_AGGRESSIVE",
    "CLANG_WARN_UNREACHABLE_CODE": "YES",
    "CLANG_WARN__DUPLICATE_METHOD_MATCH": "YES",
    "COPY_PHASE_STRIP": "NO",
    "DEBUG_INFORMATION_FORMAT": "dwarf",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES",
    "ENABLE_TESTABILITY": "YES",
    "GCC_C_LANGUAGE_STANDARD": "gnu17",
    "GCC_DYNAMIC_NO_PIC": "NO",
    "GCC_NO_COMMON_BLOCKS": "YES",
    "GCC_OPTIMIZATION_LEVEL": "0",
    "GCC_PREPROCESSOR_DEFINITIONS": ["DEBUG=1", "$(inherited)"],
    "GCC_WARN_64_TO_32_BIT_CONVERSION": "YES",
    "GCC_WARN_ABOUT_RETURN_TYPE": "YES_ERROR",
    "GCC_WARN_UNDECLARED_SELECTOR": "YES",
    "GCC_WARN_UNINITIALIZED_AUTOS": "YES_AGGRESSIVE",
    "GCC_WARN_UNUSED_FUNCTION": "YES",
    "GCC_WARN_UNUSED_VARIABLE": "YES",
    "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
    "LOCALIZATION_PREFS": "",
    "MTL_ENABLE_DEBUG_INFO": "INCLUDE_SOURCE",
    "MTL_FAST_MATH": "YES",
    "ONLY_ACTIVE_ARCH": "YES",
    "SDKROOT": "iphoneos",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG",
    "SWIFT_OPTIMIZATION_LEVEL": "-Onone",
}
PROJ_RELEASE = dict(PROJ_DEBUG)
PROJ_RELEASE.update({
    "COPY_PHASE_STRIP": "YES",
    "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
    "ENABLE_NS_ASSERTIONS": "NO",
    "GCC_OPTIMIZATION_LEVEL": "s",
    "MTL_ENABLE_DEBUG_INFO": "NO",
    "MTL_FAST_MATH": "YES",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "",
    "SWIFT_OPTIMIZATION_LEVEL": "-O",
    "VALIDATE_PRODUCT": "YES",
})
for k in ("ENABLE_TESTABILITY", "ONLY_ACTIVE_ARCH", "GCC_PREPROCESSOR_DEFINITIONS", "SWIFT_ACTIVE_COMPILATION_CONDITIONS"):
    if k in PROJ_RELEASE and k != "SWIFT_ACTIVE_COMPILATION_CONDITIONS":
        del PROJ_RELEASE[k]
PROJ_RELEASE["GCC_PREPROCESSOR_DEFINITIONS"] = ["$(inherited)"]

def target_settings(bundle_id, plist, entitlements, extra=None):
    s = {
        "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
        "CODE_SIGN_ENTITLEMENTS": entitlements,
        "CODE_SIGN_STYLE": "Automatic",
        "INFOPLIST_FILE": plist,
        "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
        "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks"],
        "PRODUCT_BUNDLE_IDENTIFIER": bundle_id,
        "PRODUCT_NAME": "$(TARGET_NAME)",
        "SDKROOT": "iphoneos",
        "SWIFT_VERSION": "5.0",
        "TARGETED_DEVICE_FAMILY": "1,2",
    }
    if extra:
        s.update(extra)
    return s

app_debug = xcconfig("app_debug", "Debug", target_settings(
    "com.firedarts.sideshow", "Sideshow/Info.plist", "Sideshow/Sideshow.entitlements",
    {"ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES": "YES"}))
app_release = xcconfig("app_release", "Release", target_settings(
    "com.firedarts.sideshow", "Sideshow/Info.plist", "Sideshow/Sideshow.entitlements",
    {"ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES": "YES"}))
kbd_debug = xcconfig("kbd_debug", "Debug", target_settings(
    "com.firedarts.sideshow.keyboard", "SideshowKeyboard/Info.plist", "SideshowKeyboard/SideshowKeyboard.entitlements",
    {"SKIP_INSTALL": "YES"}))
kbd_release = xcconfig("kbd_release", "Release", target_settings(
    "com.firedarts.sideshow.keyboard", "SideshowKeyboard/Info.plist", "SideshowKeyboard/SideshowKeyboard.entitlements",
    {"SKIP_INSTALL": "YES"}))
proj_debug = xcconfig("proj_debug", "Debug", PROJ_DEBUG)
proj_release = xcconfig("proj_release", "Release", PROJ_RELEASE)

app_cfg_list = xcconfiglist("app", [app_debug, app_release])
kbd_cfg_list = xcconfiglist("kbd", [kbd_debug, kbd_release])
proj_cfg_list = xcconfiglist("proj", [proj_debug, proj_release])

# ---------- targets ----------
def target(key, name, product_type, product_ref, phases, cfg_list, deps=None):
    attrs = {
        "buildConfigurationList": cfg_list,
        "buildPhases": phases,
        "buildRules": [],
        "dependencies": deps or [],
        "name": name,
        "productName": name,
        "productReference": product_ref,
        "productType": product_type,
    }
    return add("PBXNativeTarget", "target:" + key, attrs)

kbd_target = target("kbd", "SideshowKeyboard", "com.apple.product-type.app-extension",
                    kbd_product, [kbd_sources, kbd_frameworks, kbd_resources], kbd_cfg_list)

dep = add("PBXTargetDependency", "dep:app->kbd", {
    "target": kbd_target,
    "targetProxy": add("PBXContainerItemProxy", "proxy:app->kbd", {
        "containerPortal": uid("project"),
        "proxyType": 1,
        "remoteGlobalIDString": kbd_target,
        "remoteInfo": "SideshowKeyboard",
    }),
})

app_target = target("app", "Sideshow", "com.apple.product-type.application",
                    app_product, [app_sources, app_frameworks, app_resources, app_embed], app_cfg_list, deps=[dep])

# ---------- project ----------
project = add("PBXProject", "project", {
    "attributes": {
        "LastUpgradeCheck": "1500",
        "TargetAttributes": {
            app_target: {"CreatedOnToolsVersion": "15.0"},
            kbd_target: {"CreatedOnToolsVersion": "15.0"},
        },
    },
    "buildConfigurationList": proj_cfg_list,
    "compatibilityVersion": "Xcode 14.0",
    "developmentRegion": "en",
    "hasScannedForEncodings": 0,
    "knownRegions": ["en", "Base"],
    "mainGroup": g_main,
    "packageReferences": [pkg_firebase, pkg_googlesignin],
    "productRefGroup": g_products,
    "projectDirPath": "",
    "projectRoot": "",
    "targets": [app_target, kbd_target],
})

# ---------- serialization ----------
def q(s):
    if isinstance(s, bool):
        return "YES" if s else "NO"
    if isinstance(s, (int, float)):
        return str(s)
    if isinstance(s, str) and s and all(c.isalnum() or c in "_-./" for c in s):
        return s
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'

def emit_value(value, indent):
    pad = "\t" * indent
    if isinstance(value, dict):
        if not value:
            return "{ }"
        lines = ["{"]
        for k, v in value.items():
            lines.append(pad + "\t" + q(k) + " = " + emit_value(v, indent + 1) + ";")
        lines.append(pad + "}")
        return "\n".join(lines)
    if isinstance(value, list):
        if not value:
            return "( )"
        lines = ["("]
        for v in value:
            lines.append(pad + "\t" + emit_value(v, indent + 1) + ",")
        lines.append(pad + ")")
        return "\n".join(lines)
    return q(value)

def emit_object(oid, obj, indent=2):
    pad = "\t" * indent
    lines = [pad + oid + " = {"]
    lines.append(pad + "\tisa = " + obj["isa"] + ";")
    for k, v in obj.items():
        if k == "isa":
            continue
        lines.append(pad + "\t" + q(k) + " = " + emit_value(v, indent + 1) + ";")
    lines.append(pad + "};")
    return "\n".join(lines)

out = []
out.append("// !$*UTF8*$!")
out.append("{")
out.append("\tarchiveVersion = 1;")
out.append("\tclasses = {")
out.append("\t};")
out.append("\tobjectVersion = 56;")
out.append("\tobjects = {")
for oid in sorted(objects.keys(), key=lambda i: (objects[i]["isa"], i)):
    out.append(emit_object(oid, objects[oid]))
out.append("\t};")
out.append("\trootObject = " + project + ";")
out.append("}")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    f.write("\n".join(out) + "\n")
print("wrote", OUT, "objects:", len(objects))
