---
name: summarize
description: Summarize a thought into concise key points
trigger: both
parameters:
  format:
    type: string
    description: "Output format: bullets, paragraph, or tldr"
    default: bullets
---

Please summarize the current thought into {{format}} format.

Rules:
- Capture the core insight and any actionable takeaways
- Remove redundancy but preserve nuance
- If the thought references other ideas, note the connections
- Keep it concise — the summary should be significantly shorter than the original
