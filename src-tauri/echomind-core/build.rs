fn main() {
    // Compile sqlite-vec as a static library
    // The sqlite-vec source lives in the parent tauri directory
    let sqlite_vec_dir = std::path::Path::new("../sqlite-vec");

    cc::Build::new()
        .file(sqlite_vec_dir.join("sqlite-vec.c"))
        .include(sqlite_vec_dir)
        .define("SQLITE_CORE", None)
        .warnings(false)
        .compile("sqlite_vec");
}
