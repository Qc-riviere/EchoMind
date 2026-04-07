use std::sync::Arc;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber;

mod routes;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // Use the same database path as the Tauri app
    let db_path = dirs::data_dir()
        .expect("Cannot determine data directory")
        .join("com.fu-qianchen.echomind")
        .join("echomind.db");

    // Ensure data directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).expect("Failed to create data directory");
    }

    tracing::info!("Opening database at: {}", db_path.display());

    let core = echomind_core::EchoMind::open(&db_path)
        .expect("Failed to open EchoMind database");
    let state = Arc::new(core);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .nest("/api", routes::api_routes())
        .layer(cors)
        .with_state(state);

    let addr = "127.0.0.1:8765";
    tracing::info!("EchoMind server listening on {}", addr);
    println!("EchoMind server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind");

    axum::serve(listener, app).await.expect("Server error");
}
