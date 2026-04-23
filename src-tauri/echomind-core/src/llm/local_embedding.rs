use std::path::PathBuf;
use std::sync::Mutex;

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use once_cell::sync::OnceCell;

pub const LOCAL_EMBED_DIM: usize = 512;
const DEFAULT_MODEL: EmbeddingModel = EmbeddingModel::BGESmallZHV15;

static MODEL: OnceCell<Mutex<TextEmbedding>> = OnceCell::new();
static CACHE_DIR: OnceCell<PathBuf> = OnceCell::new();

/// Override cache directory for ONNX model files. Call once before first embed.
/// Silently no-ops if already set.
pub fn set_cache_dir(dir: PathBuf) {
    let _ = CACHE_DIR.set(dir);
}

fn ensure_model() -> Result<&'static Mutex<TextEmbedding>, String> {
    MODEL.get_or_try_init(|| {
        let mut opts = InitOptions::new(DEFAULT_MODEL).with_show_download_progress(false);
        if let Some(dir) = CACHE_DIR.get() {
            opts = opts.with_cache_dir(dir.clone());
        }
        TextEmbedding::try_new(opts)
            .map(Mutex::new)
            .map_err(|e| format!("local embedding init failed: {e}"))
    })
}

/// Run local embedding synchronously. Callers should wrap in spawn_blocking.
fn embed_sync(text: &str) -> Result<Vec<f32>, String> {
    let model = ensure_model()?;
    let guard = model.lock().map_err(|e| format!("mutex poisoned: {e}"))?;
    let mut out = guard
        .embed(vec![text.to_string()], None)
        .map_err(|e| format!("local embedding failed: {e}"))?;
    out.pop()
        .ok_or_else(|| "local embedding returned empty result".to_string())
}

pub async fn embed(text: &str) -> Result<Vec<f32>, String> {
    let t = text.to_string();
    tokio::task::spawn_blocking(move || embed_sync(&t))
        .await
        .map_err(|e| format!("embedding task join error: {e}"))?
}
