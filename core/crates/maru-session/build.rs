use std::path::{Path, PathBuf};
use std::process::Command;

// 손으로 옮기면 핀을 올릴 때 서수가 조용히 밀려서 헤더에서 읽는다.
const ENUMS: &[&str] = &[
    "GHOSTTY_SUCCESS",
    "GHOSTTY_NO_VALUE",
    "GHOSTTY_FORMATTER_FORMAT_PLAIN",
    "GHOSTTY_FORMATTER_FORMAT_VT",
    "GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES",
    "GHOSTTY_TERMINAL_DATA_CURSOR_X",
    "GHOSTTY_TERMINAL_DATA_CURSOR_Y",
    "GHOSTTY_TERMINAL_DATA_SCROLLBAR",
];

fn main() {
    let manifest = PathBuf::from(env("CARGO_MANIFEST_DIR"));
    let root = manifest.join("../..");
    let out = PathBuf::from(env("OUT_DIR"));
    let pin_file = root.join("ghostty-vt.env");
    let script = root.join("scripts/build-ghostty-vt.sh");
    println!("cargo:rerun-if-env-changed=MARU_GHOSTTY_VT_DIR");
    println!("cargo:rerun-if-changed={}", pin_file.display());
    println!("cargo:rerun-if-changed={}", script.display());

    let src = match std::env::var_os("MARU_GHOSTTY_VT_DIR") {
        Some(dir) => {
            let dir = PathBuf::from(dir);
            println!(
                "cargo:rerun-if-changed={}",
                dir.join("lib/libghostty-vt.a").display()
            );
            dir
        }
        None => build(&script, &pin_file, &out),
    };

    write_enums(
        &src.join("include/ghostty/vt"),
        &out.join("ghostty_enums.rs"),
    );

    // 옆에 같은 이름의 .dylib 가 있으면 링커가 `static=` 에도 그쪽을 집어 런타임에 죽는다.
    let link_dir = out.join("ghostty-vt-link");
    std::fs::create_dir_all(&link_dir).unwrap();
    std::fs::copy(
        src.join("lib/libghostty-vt.a"),
        link_dir.join("libghostty-vt.a"),
    )
    .unwrap_or_else(|e| panic!("{} 에 lib/libghostty-vt.a 가 없다: {e}", src.display()));
    println!("cargo:rustc-link-search=native={}", link_dir.display());
    println!("cargo:rustc-link-lib=static=ghostty-vt");
}

fn env(key: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| panic!("{key} 가 없다"))
}

fn read_commit(pin_file: &Path) -> String {
    read(pin_file)
        .lines()
        .find_map(|l| l.strip_prefix("GHOSTTY_COMMIT="))
        .map(|c| c.trim().to_string())
        .expect("ghostty-vt.env 에 GHOSTTY_COMMIT 이 없다")
}

fn build(script: &Path, pin_file: &Path, out: &Path) -> PathBuf {
    let target = env("TARGET");
    let commit = read_commit(pin_file);
    // 커밋만으로 키를 잡으면 빌드 옵션이나 zig 버전을 바꿔도 옛 라이브러리를 그대로 링크한다.
    let mut hasher = std::hash::DefaultHasher::new();
    std::hash::Hash::hash(&(read(script), read(pin_file)), &mut hasher);
    let inputs = std::hash::Hasher::finish(&hasher);
    // OUT_DIR 은 <target 디렉토리>[/<triple>]/<profile>/build/<crate-hash>/out 이다.
    let cache_root = out.ancestors().nth(4).expect("OUT_DIR 이 예상보다 얕다");
    let dest = cache_root
        .join("ghostty-vt")
        .join(format!("{}-{inputs:016x}-{target}", &commit[..12]));
    if dest.join("lib/libghostty-vt.a").exists() {
        return dest;
    }

    let mut cmd = Command::new("bash");
    // cargo 가 동시에 둘 돌아도 같은 자리에 쓰지 않게 한다.
    let tmp = dest.with_extension(format!("tmp-{}", std::process::id()));
    cmd.arg(script).arg(&tmp);
    if target != env("HOST") {
        cmd.arg(zig_target(&target));
    }
    println!(
        "cargo:warning=libghostty-vt 를 소스에서 빌드한다 (ghostty {}, 약 1분)",
        &commit[..12]
    );
    let status = cmd.status().expect("bash 를 실행할 수 없다");
    if !status.success() {
        std::fs::remove_dir_all(&tmp).ok();
        panic!("scripts/build-ghostty-vt.sh 가 실패했다 — zig 버전은 ghostty-vt.env 를 보라");
    }
    if std::fs::rename(&tmp, &dest).is_err() {
        if dest.join("lib/libghostty-vt.a").exists() {
            std::fs::remove_dir_all(&tmp).ok();
        } else {
            std::fs::remove_dir_all(&dest).unwrap();
            std::fs::rename(&tmp, &dest).unwrap();
        }
    }
    dest
}

fn zig_target(rust_target: &str) -> &'static str {
    match rust_target {
        "aarch64-apple-darwin" => "aarch64-macos",
        "x86_64-apple-darwin" => "x86_64-macos",
        "x86_64-unknown-linux-gnu" => "x86_64-linux-gnu",
        "aarch64-unknown-linux-gnu" => "aarch64-linux-gnu",
        other => {
            panic!("{other} 를 zig 타깃으로 옮기는 법을 모른다 — build.rs 의 zig_target 에 더하라")
        }
    }
}

fn write_enums(include: &Path, out: &Path) {
    println!("cargo:rerun-if-changed={}", include.display());
    let mut headers = String::new();
    for entry in std::fs::read_dir(include).unwrap().flatten() {
        if entry.path().extension().is_some_and(|e| e == "h") {
            headers.push_str(&strip_comments(&read(&entry.path())));
        }
    }
    let consts: String = ENUMS
        .iter()
        .map(|name| {
            let v = enum_value(&headers, name)
                .unwrap_or_else(|| panic!("{} 의 헤더에서 {name} 을 못 찾았다", include.display()));
            format!("pub const {name}: i32 = {v};\n")
        })
        .collect();
    std::fs::write(out, consts).unwrap();
}

fn strip_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut rest = src;
    while let Some(i) = rest.find('/') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        if let Some(body) = rest.strip_prefix("/*") {
            rest = body.split_once("*/").map_or("", |(_, after)| after);
        } else if rest.starts_with("//") {
            rest = rest.find('\n').map_or("", |n| &rest[n..]);
        } else {
            out.push('/');
            rest = &rest[1..];
        }
    }
    out.push_str(rest);
    out
}

fn enum_value(headers: &str, name: &str) -> Option<i64> {
    let at = headers.match_indices(name).map(|(i, _)| i).find(|&i| {
        let before = headers[..i].chars().next_back();
        let after = headers[i + name.len()..].trim_start().chars().next();
        before.is_some_and(char::is_whitespace) && matches!(after, Some(',' | '=' | '}'))
    })?;
    let open = headers[..at].rfind('{')? + 1;
    let mut next = 0;
    for entry in headers[open..].split(',') {
        let (n, v) = match entry.split_once('=') {
            Some((n, v)) => (n.trim(), v.trim().parse().ok()?),
            None => (entry.trim(), next),
        };
        if n == name {
            return Some(v);
        }
        next = v + 1;
    }
    None
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("{} 를 읽을 수 없다: {e}", path.display()))
}
