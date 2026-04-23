---
name: brainstorm
description: Generate related ideas and unexpected connections from a thought
trigger: both
parameters:
  count:
    type: string
    description: How many ideas to generate
    default: "5"
---

Starting from the current thought, brainstorm {{count}} related ideas or unexpected connections.

Rules:
- Mix obvious extensions with surprising lateral jumps
- For each idea, explain the connection back to the original thought
- Include at least one idea from a completely different domain
- Prioritize novelty and usefulness
- Format as a numbered list with brief explanations
