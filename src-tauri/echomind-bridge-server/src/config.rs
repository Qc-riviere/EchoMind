use std::env;
use std::path::PathBuf;

pub struct Config {
    pub bind_addr: String,
    pub jwt_secret: String,
    pub data_dir: PathBuf,
    pub admin_token: String,
    pub encryption_key: [u8; 32],
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let bind_addr = env::var("BRIDGE_BIND").unwrap_or_else(|_| "0.0.0.0:8443".to_string());
        let jwt_secret = env::var("BRIDGE_JWT_SECRET")
            .map_err(|_| "BRIDGE_JWT_SECRET env var is required".to_string())?;
        if jwt_secret.len() < 32 {
            return Err("BRIDGE_JWT_SECRET must be >=32 chars".to_string());
        }
        let data_dir = env::var("BRIDGE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));
        let admin_token = env::var("BRIDGE_ADMIN_TOKEN")
            .map_err(|_| "BRIDGE_ADMIN_TOKEN env var is required".to_string())?;
        if admin_token.len() < 16 {
            return Err("BRIDGE_ADMIN_TOKEN must be >=16 chars".to_string());
        }
        use base64::Engine;
        let enc_b64 = env::var("BRIDGE_ENCRYPTION_KEY")
            .map_err(|_| "BRIDGE_ENCRYPTION_KEY env var is required (base64 of 32 bytes)".to_string())?;
        let enc_bytes = base64::engine::general_purpose::STANDARD
            .decode(enc_b64.trim())
            .map_err(|e| format!("BRIDGE_ENCRYPTION_KEY base64 decode: {e}"))?;
        if enc_bytes.len() != 32 {
            return Err(format!("BRIDGE_ENCRYPTION_KEY must decode to 32 bytes, got {}", enc_bytes.len()));
        }
        let mut encryption_key = [0u8; 32];
        encryption_key.copy_from_slice(&enc_bytes);

        Ok(Self { bind_addr, jwt_secret, data_dir, admin_token, encryption_key })
    }
}
