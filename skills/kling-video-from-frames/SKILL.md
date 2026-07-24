# Kling Video From Frames Skill

**Skill name:** `kling-video-from-frames`

**Purpose:** Generate a cinematic AI video animation from a start frame image and an end frame image using Kling AI MCP. The AI interpolates the motion between the two frames.

---

## When to Use This Skill
- Logo reveal animations (partial logo → complete logo)
- Product transformation videos (before → after)
- Scene transitions (empty → populated)
- Any animation where you have a defined start state and end state as images

---

## Prerequisites
- Kling MCP server running (`/Volumes/Wotg Drive Mike/GitHub/kling-mcp-direct/server.mjs`)
- Kling API key configured in Claude Desktop config
- Both images must be hosted at publicly accessible URLs (not local file paths)

---

## CRITICAL: Model Selection

### ⚠️ ONLY `kling-v1-6` supports both start AND end frame

| Model | Start Frame | End Frame | Notes |
|-------|:-----------:|:---------:|-------|
| **kling-v1-6** | ✅ | ✅ | **USE THIS for start+end frame** |
| kling-v2-master | ✅ | ❌ | Returns error 1201: "Image tail is not supported" |
| kling-v2-5-turbo | ✅ | ❌ | Start frame only |
| kling-v3 | ✅ | ❌ | Start frame only |

**If you only have a start frame** (no end frame), use `kling-v2-master` for best quality.

---

## Step-by-Step Workflow

### Step 1: Prepare Images

Both images must be:
- Same aspect ratio (or close)
- PNG or JPG format
- Hosted at a **public URL** that Kling's servers can fetch over the internet

**⚠️ CRITICAL — Kling cannot use local file paths or base64 data.** The `start_image_url` and `end_image_url` parameters must be real `https://` URLs. A local path like `/Users/mike/Downloads/frame.png`, a `file://` path, or a base64 data URI will fail or silently produce bad results — Kling's servers fetch the image themselves over the internet; they never receive uploaded bytes from us directly.

**If the user pasted/uploaded the images directly in the chat**, those images only exist in the conversation (and possibly somewhere on local disk like Desktop/Downloads) — Kling has no access to either. The image must be re-hosted on a domain that's already publicly reachable before it can be used:

```bash
# 1. Locate where the pasted/uploaded image actually landed
ls -t ~/Desktop/*.png ~/Downloads/*.png 2>/dev/null | head -5
ls /mnt/user-data/uploads/ 2>/dev/null

# 2. Copy BOTH frames into the Marga portal's public assets folder — this piggybacks
#    on care.marga.biz, which is already live via the Cloudflare tunnel
cp "~/Desktop/ChatGPT Image ....png" \
   "/Volumes/Wotg Drive Mike/GitHub/Marga-App/marga-service-portal/public/assets/start-frame.png"
cp "~/Desktop/ChatGPT Image ....png" \
   "/Volumes/Wotg Drive Mike/GitHub/Marga-App/marga-service-portal/public/assets/end-frame.png"
```

**Never skip this step.** Even if the image already exists as a local file, copy it into `public/assets/` and use the resulting `care.marga.biz` URL — don't pass base64 data, blob URLs, or local `/Users/...` paths to `start_image_url` / `end_image_url`.

Then verify both are actually reachable from the public internet — this is the same path Kling's servers will hit — before calling Kling:
```bash
curl -s -o /dev/null -w "%{http_code}" https://care.marga.biz/assets/start-frame.png
curl -s -o /dev/null -w "%{http_code}" https://care.marga.biz/assets/end-frame.png
```
Both must return `200`. If either returns `404`, the file wasn't copied to the right place — fix that before proceeding to Step 2.

### Step 2: Generate the Video

**MCP Tool:** `kling_generate_video_from_image`

**Required parameters:**
```
start_image_url:  "https://care.marga.biz/assets/start-frame.png"
end_image_url:    "https://care.marga.biz/assets/end-frame.png"
model:            "kling-v1-6"        ← MUST be v1-6 for end frame support
mode:             "pro"               ← pro = best quality
aspect_ratio:     "1:1"               ← or "16:9" or "9:16"
duration:         5                   ← seconds (5 or 10)
cfg_scale:        0.9                 ← 0.0-1.0, higher = more faithful to source images
prompt:           "your animation description"
negative_prompt:  "zoom, pan, camera movement, blurry, distorted, watermark"
```

### Step 3: Write the Prompt

**Prompt max length:** 2500 characters

**Template for logo reveals:**
```
Premium minimalist logo intro. Pure black background.
CRITICAL: Logo must be SMALL — only 30 to 35 percent of frame width,
perfectly centered with generous black space on all four sides.
Start frame: [describe what's visible in image 1]
End frame: [describe the final complete image 2]
Animation: [describe the motion between them — line drawing, assembly, morph, etc.]
Logo lines must remain CRISP, SHARP, and CLEAN — no excessive bloom, no unnecessary glow.
[color description] on pure black.
Smooth elegant motion, no camera movement, no zoom, no shaking.
Premium technology brand reveal. Hold on completed result.
```

**Template for scene transitions:**
```
Animate smoothly from the start frame to the end frame.
CAMERA LOCKED — no zoom, pan, tilt, or camera movement.
Preserve all elements from both frames.
The transition should feel [cinematic/organic/technical/elegant].
[Describe specific motion behaviors]
Dark, calm, minimal, premium atmosphere.
Smooth controlled motion throughout.
```

**Negative prompt (always include):**
```
zoom, pan, camera movement, shaking, fast cuts, cropped text, 
cut off elements, excessive bloom, unnecessary glow, blurry, 
soft focus, low quality, watermark, distortion
```

### Step 4: Check Task Status

After submission, poll the task:
```
Tool: kling_check_task
Parameter: task_id = "the_task_id_returned"
```

Typical wait time: 3-5 minutes for pro mode.

Task statuses:
- `submitted` — in queue
- `processing` — generating
- `succeed` — done, `task_result.videos[0].url` has the download URL
- `failed` — generation failed, check `task_status_msg`

### Step 5: Download and Compress

```bash
# Download raw video
curl -L "VIDEO_URL_FROM_TASK_RESULT" -o /path/to/raw-output.mp4

# Compress for web (720p, ~100-500KB)
ffmpeg -y -i raw-output.mp4 \
  -vf "scale=1280:720" \
  -c:v libx264 -crf 22 -preset slow -an -movflags +faststart \
  output-compressed.mp4

# For 1:1 square output (already 1:1 from Kling):
ffmpeg -y -i raw-output.mp4 \
  -c:v libx264 -crf 22 -preset slow -an -movflags +faststart \
  output-compressed.mp4
```

### Step 6: Make Logo Smaller (If Needed)

If the logo fills too much of the frame, add black padding:
```bash
# Scale content to 70% and center with black padding
ffmpeg -y -i raw-output.mp4 \
  -vf "scale=iw*0.7:ih*0.7,pad=iw/0.7:ih/0.7:(ow-iw)/2:(oh-ih)/2:black" \
  -c:v libx264 -crf 22 -preset slow -an -movflags +faststart \
  output-smaller.mp4
```

---

## Aspect Ratio Guide

| Use Case | Aspect Ratio | Why |
|----------|:------------:|-----|
| Logo intro (cross-device) | **1:1** | Works on both mobile and desktop without cropping |
| Website hero background | **16:9** | Standard landscape, matches desktop viewport |
| Mobile-first background | **9:16** | Portrait, fills phone screen |
| Social media ad | **9:16** or **1:1** | TikTok/Reels = 9:16, Facebook/IG feed = 1:1 |

---

## cfg_scale Guide

| Value | Effect | When to Use |
|-------|--------|-------------|
| 0.5 | Loose — AI has creative freedom | Abstract animations, mood pieces |
| 0.7 | Balanced — follows images but adds flair | General use |
| 0.85 | Tight — closely follows source images | Logo reveals, branded content |
| **0.9** | **Very tight — maximum fidelity** | **Logos, precise compositions** |
| 1.0 | Strictest — almost no creative deviation | Rarely useful, can be stiff |

---

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `1201: Image tail is not supported` | Using v2-master or v3 with end frame | Switch to `kling-v1-6` |
| `1201: prompt size must be between 0 and 2500` | Prompt too long | Trim to under 2500 chars |
| `Token is invalid` | Wrong API key format or expired | Check key in Claude Desktop config |
| `Insufficient balance` | No credits | Buy more at kling.ai/dev/pricing |
| Logo too big / text cropped | Source image fills entire frame | Use padding in prompt or ffmpeg post-processing |

---

## Downloads Location
All Kling-generated videos are saved to:
```
/Volumes/Wotg Drive Mike/GitHub/kling-mcp-direct/downloads/
```

---

## Real Example — Marga Logo Intro

**Start frame:** Two glowing silver bracket shapes on pure black (partial logo)
**End frame:** Complete silver MARGA connected-M logo with wordmark

**What worked:**
```
Model: kling-v1-6
Mode: pro
Aspect ratio: 1:1
Duration: 5 seconds
cfg_scale: 0.9
```

**Prompt used:**
```
Premium minimalist logo intro. Pure black background. 
CRITICAL: Logo must be SMALL — only 30 to 35 percent of frame width, 
perfectly centered with generous black space on all four sides. 
Full MARGA wordmark always completely visible, never cropped. 
Start frame: two glowing outer silver line segments on pure black. 
End frame: complete MARGA silver-white metallic M logo with wordmark below. 
Animation: outer lines animate smoothly inward along exact final path. 
Inner connected M path reveals through precise line-drawing motion. 
Subtle connection pulse where paths meet. MARGA wordmark fades in cleanly 
below emblem matching exact final frame layout. Hold on completed logo. 
Logo lines must remain CRISP, SHARP, and CLEAN — no excessive bloom, 
no unnecessary glow. Silver-white metallic on pure black. 
Only subtle faint drifting particles and tiny emerald-green teal dust 
in background atmosphere only. Minimal soft halo only. 
Premium luxurious technology brand. 
Smooth elegant motion, no camera movement, no zoom.
```

**Result:** `logo-intro-v3-1x1.mp4` (683KB, 1:1, 5 seconds)
