---
name: rewrite
description: Rewrite a thought in a different style or for a different audience
trigger: manual
parameters:
  style:
    type: string
    description: "Target style: academic, casual, tweet, elevator-pitch, or technical"
---

Rewrite the current thought in {{style}} style.

Rules:
- Preserve the core meaning and all key information
- Adapt vocabulary, sentence structure, and tone to match the target style
- If the style has length constraints (e.g., tweet = 280 chars), respect them
- Output only the rewritten text, no commentary
