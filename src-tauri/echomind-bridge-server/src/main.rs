mod auth;
mod config;
mod crypto;
mod db;
mod error;
mod llm;
mod pairing;
mod routes;
mod state;

use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "echomind_bridge_server=info,tower_http=info".into()),
        )
        .init();

    let cfg = match config::Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("config error: {e}");
            std::process::exit(1);
        }
    };

    if let Err(e) = std::fs::create_dir_all(&cfg.data_dir) {
        eprintln!("failed to create data dir {}: {e}", cfg.data_dir.display());
        std::process::exit(1);
    }

    let bind = cfg.bind_addr.clone();
    let state = match state::AppState::new(cfg) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("state init error: {e}");
            std::process::exit(1);
        }
    };

    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);

    let app = routes::router(state).layer(cors).layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .unwrap_or_else(|e| panic!("bind {bind}: {e}"));
    tracing::info!("echomind-bridge-server listening on {bind}");

    axum::serve(listener, app).await.expect("serve");
}
