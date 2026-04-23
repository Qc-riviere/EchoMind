use serde::{Deserialize, Serialize};

use crate::db::thoughts::Thought;

/// Subset rules: user-configured filter deciding which thoughts sync to VPS.
/// All conditions are AND-combined. Tag lists are OR within their list.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SubsetRules {
    /// Only include thoughts newer than this many days. None = no time limit.
    pub time_window_days: Option<u32>,
    /// Only include thoughts carrying at least one of these tags. Empty = any.
    pub include_tags: Vec<String>,
    /// Exclude thoughts carrying any of these tags.
    pub exclude_tags: Vec<String>,
    /// Exclude archived thoughts. Defaults to true via [`effective_exclude_archived`].
    pub exclude_archived: Option<bool>,
}

impl SubsetRules {
    pub fn matches(&self, t: &Thought) -> bool {
        if self.exclude_archived.unwrap_or(true) && t.is_archived {
            return false;
        }
        if let Some(days) = self.time_window_days {
            if !within_days(&t.created_at, days) {
                return false;
            }
        }
        let tag_list = parse_tags(t.tags.as_deref());
        if !self.include_tags.is_empty()
            && !self.include_tags.iter().any(|want| tag_list.iter().any(|t| t == want))
        {
            return false;
        }
        if self.exclude_tags.iter().any(|bad| tag_list.iter().any(|t| t == bad)) {
            return false;
        }
        true
    }
}

fn parse_tags(s: Option<&str>) -> Vec<String> {
    match s {
        Some(v) => v
            .split(|c: char| c == ',' || c == '，' || c == ';')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect(),
        None => vec![],
    }
}

fn within_days(rfc3339: &str, days: u32) -> bool {
    use chrono::{DateTime, Duration, Utc};
    match DateTime::parse_from_rfc3339(rfc3339) {
        Ok(dt) => {
            let cutoff = Utc::now() - Duration::days(days as i64);
            dt.with_timezone(&Utc) >= cutoff
        }
        Err(_) => true, // unparseable → don't filter out
    }
}
