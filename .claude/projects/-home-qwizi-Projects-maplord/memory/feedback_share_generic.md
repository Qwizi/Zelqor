---
name: share_system_generic
description: Share system should be generic/extensible, not limited to match results only
type: feedback
---

When building share/public-link features, make them generic — not hardcoded to one resource type. Use a generic share token system that can share different resource types (matches, replays, profiles, etc.) without login.

**Why:** User wants flexibility to share other things in the future, not just match results.
**How to apply:** Design share tokens with a `resource_type` + `resource_id` pattern so the same system works for any shareable content.
