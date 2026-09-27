---
type: decision
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 91d9085662416a6cf983f3f92907b4e7f52e40ee
source: docs/04-architecture/ADR-001-stack-and-hosting.md
confidence: high
---
# 001-stack-free-tier

$0 is a HARD constraint (founder 2026-09-27). Primary: Supabase Free + Vercel Hobby + GitHub Actions. Verified alternates (ADR-001 Amendment A §A2): hosting Netlify Free (S) > Cloudflare Workers Free via OpenNext (M, 10 ms CPU risk) > Oracle Always Free VM (M + ops; now 2 OCPU/12 GB); Render staging only. DB/auth: Neon Free + Neon Auth (M–L) > self-hosted Supabase on Oracle VM. Rejected: Appwrite (pauses on no dev activity), Firestore, Turso/D1. `TRUSTED_PROXY` (§A3) replaces the own-server reverse-proxy requirement of AR-7.

Source: `docs/04-architecture/ADR-001-stack-and-hosting.md`
