fn main() {
    // Compile sqlite-vec as a static library
    cc::Build::new()
        .file("sqlite-vec/sqlite-vec.c")
        .include("sqlite-vec")
        .define("SQLITE_CORE", None)
        .warnings(false)
        .compile("sqlite_vec");

    tauri_build::build()
}
