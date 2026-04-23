---
name: translate
description: Translate a thought into another language while preserving nuance
trigger: manual
parameters:
  language:
    type: string
    description: Target language (e.g., English, Chinese, Japanese, Spanish)
---

Translate the current thought into {{language}}.

Rules:
- Preserve the original meaning, tone, and nuance
- Adapt idioms and cultural references appropriately
- If technical terms have standard translations in the target language, use them
- Output only the translation, no commentary
