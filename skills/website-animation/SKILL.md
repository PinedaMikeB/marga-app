# Website Animation Skill — Marga Care Portal

## Overview
This skill documents how to create premium animated website experiences using AI-generated video (Kling AI), CSS animations, and the NajmAI dark theme system. Built for the Marga Care customer portal at care.marga.biz.

---

## 1. Kling AI Video Generation via MCP

### Setup
- Custom MCP server: `/Volumes/Wotg Drive Mike/GitHub/kling-mcp-direct/server.mjs`
- Uses Kling API 2.0 single bearer token format
- Claude Desktop config: `~/Library/Application Support/Claude/claude_desktop_config.json`

### Available Tools
```
kling_generate_video         — text to video
kling_generate_video_from_image — image to video (start + optional end frame)
kling_check_task             — poll task status until complete
kling_account_info           — check balance
```

### Model Selection Guide
| Model | Best For | End Frame Support | Cost |
|-------|----------|-------------------|------|
| kling-v1-6 | Logo reveals with start+end frame | ✅ YES | 3.5 units/5s |
| kling-v2-master | Cinematic single-image animation | ❌ NO | 5 units/5s |
| kling-v2-5-turbo | Fast UGC/social clips | ❌ NO | 1.5 units/5s |
| kling-v3 | Highest quality text-to-video | ❌ NO | 5 units/5s |

### Key Rules
- **Prompt max length:** 2500 characters
- **cfg_scale:** 0.85-0.9 for maximum fidelity to source images
- **Only kling-v1-6** supports both `start_image_url` AND `end_image_url`
- Images must be publicly accessible URLs
- Always include negative prompt: `zoom, pan, camera movement, blurry, distorted, watermark`

### Logo Intro Generation Workflow

#### Step 1: Prepare Start + End Frame Images
- Start frame: partial logo elements on pure black background
- End frame: complete logo with wordmark on pure black background
- Upload both to a public URL (e.g., `care.marga.biz/assets/`)

#### Step 2: Generate with Kling
```
Model: kling-v1-6
Mode: pro
Aspect ratio: 1:1 (works on both mobile and desktop)
Duration: 5 seconds
cfg_scale: 0.9
```

#### Step 3: Prompt Template for Logo Reveal
```
Premium minimalist logo intro. Pure black background. 
CRITICAL: The logo must be SMALL — only 30 to 35 percent of frame width, 
perfectly centered with generous black space on all four sides.
Start frame: [describe start frame elements]
End frame: [describe final logo]
Animation: [describe the motion — line drawing, assembly, morphing]
Logo lines must remain CRISP, SHARP, and CLEAN — no excessive bloom.
Silver-white metallic on pure black.
Smooth elegant motion, no camera movement, no zoom.
```

#### Step 4: Compress for Web
```bash
# Desktop (720p, ~150KB)
ffmpeg -y -i raw.mp4 -vf "scale=1280:720" \
  -c:v libx264 -crf 22 -preset slow -an -movflags +faststart output.mp4

# Mobile portrait (center crop)
ffmpeg -y -i raw.mp4 -vf "crop=594:1056:647:0,scale=430:763" \
  -c:v libx264 -crf 24 -preset slow -an -movflags +faststart output-mobile.mp4

# Slow down video (2.5x slower)
ffmpeg -y -i raw.mp4 -filter:v "setpts=2.5*PTS,scale=1280:720" \
  -c:v libx264 -crf 26 -preset slow -an -movflags +faststart output-slow.mp4
```

### Cinematic Background Video Workflow

#### Step 1: Create or use reference image
- Network diagram, technician at work, machine close-up, etc.

#### Step 2: Generate with Kling (image-to-video)
```
Model: kling-v2-master (best quality, no end frame needed)
Mode: pro
Aspect ratio: 16:9
Duration: 5 seconds
cfg_scale: 0.85
```

#### Step 3: Prompt Template for Background Animation
```
Animate this [description] into a seamless looping background.
CAMERA LOCKED — absolutely no zoom, pan, tilt, or camera movement.
Preserve every element exactly as placed in the original image.
[Describe specific animation behaviors for each element]
Dark, calm, minimal, premium, professional atmosphere.
Perfectly seamless loop — final frame matches first frame.
```

#### Step 4: Embed as Video Background
```html
<section class="hero-section">
  <video class="hero-video" autoplay muted loop playsinline>
    <source src="/assets/bg-desktop.mp4" media="(min-width: 640px)" type="video/mp4" />
    <source src="/assets/bg-mobile.mp4" type="video/mp4" />
  </video>
  <div class="hero-veil"></div>  <!-- gradient overlay -->
  <div class="hero-content">     <!-- text floats on top -->
    <h2>Your content here</h2>
  </div>
</section>
```

```css
.hero-section {
  position: relative;
  overflow: hidden;
  border-radius: 14px;
  min-height: 240px;
}
.hero-video {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  opacity: 0.55;
  z-index: 0;
}
.hero-veil {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(180deg, 
    rgba(10,9,20,.2) 0%, 
    rgba(10,9,20,.55) 45%, 
    rgba(10,9,20,.92) 100%
  );
}
.hero-content {
  position: relative;
  z-index: 2;
  padding: 20px;
}
```

---

## 2. Video Intro System

### HTML Structure
```html
<div id="introOverlay">
  <video id="introVideo" playsinline muted
         style="display:block;background:#000;object-fit:contain;width:100vw;height:100vh;">
    <source src="/assets/intro.mp4?v=TIMESTAMP" type="video/mp4" />
  </video>
  <button id="introSkip">Skip →</button>
</div>
```

### JS Controller (inline, runs before module scripts)
```javascript
(function() {
  var overlay = document.getElementById('introOverlay');
  var video = document.getElementById('introVideo');
  var dismissed = false;

  overlay.classList.add('active');

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    overlay.classList.add('dismissing');
    setTimeout(function() {
      overlay.style.display = 'none';
      window.__margaIntroDone = true;  // Global flag for race condition
      window.dispatchEvent(new CustomEvent('marga:intro:done'));
    }, 700);
  }

  // Hard timeout — never hang
  setTimeout(dismiss, 7000);

  // Try autoplay
  video.muted = true;
  var p = video.play();
  if (p) p.catch(function() {
    // Autoplay blocked — show tap hint or auto-dismiss
    setTimeout(dismiss, 3000);
  });

  video.addEventListener('ended', dismiss);
  document.getElementById('introSkip').addEventListener('click', dismiss);
})();
```

### Module-side waitForIntro (in app init)
```javascript
function waitForIntro() {
  return new Promise(function(resolve) {
    if (window.__margaIntroDone) return resolve();
    window.addEventListener('marga:intro:done', resolve, { once: true });
    setTimeout(resolve, 8000);  // Safety net
  });
}

async function init() {
  await waitForIntro();
  // ... rest of app init
}
```

### Key Gotchas
1. **Race condition:** Inline scripts fire BEFORE deferred module scripts. Use `window.__margaIntroDone` flag.
2. **iOS autoplay:** iOS blocks autoplay even for muted videos in some contexts. Always have a fallback.
3. **Service worker caching:** SW can cache the video and serve stale versions. Use query string versioning: `?v=TIMESTAMP`
4. **1:1 aspect ratio** works best for cross-device: letterboxes on landscape, fills on portrait.
5. **No `poster` attribute** if the poster image is different content — it flashes before video loads.

---

## 3. NajmAI-Inspired Dark Theme System

### CSS Variables
```css
:root {
  --bg:        #000000;
  --surface:   #17171f;
  --border:    rgba(255,255,255,.07);
  --ink:       #f0efff;
  --ink-2:     #b0aec8;
  --ink-3:     #6e6c84;
  --accent:    #8b78ff;
  --green:     #34d399;
  --amber:     #fbbf24;
  --red:       #f87171;
  --ease-out:  cubic-bezier(.22,1,.36,1);
}
```

### Ambient Glow Background
```html
<div class="ambient-bg">
  <div class="glow glow-1"></div>
  <div class="glow glow-2"></div>
</div>
```
```css
.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: .35;
  animation: glowDrift 18s ease-in-out infinite;
}
```

### Staggered Reveal Animation
```css
.reveal-up {
  opacity: 0;
  transform: translateY(32px);
  transition: opacity .7s cubic-bezier(.22,1,.36,1), transform .7s cubic-bezier(.22,1,.36,1);
}
.reveal-up.revealed { opacity: 1; transform: translateY(0); }
```
Trigger in JS:
```javascript
document.querySelectorAll('.reveal-up').forEach((el, i) => {
  setTimeout(() => el.classList.add('revealed'), 60 + i * 110);
});
```

### Scrolling Activity Ticker
```html
<div class="activity-ticker-wrap">
  <div class="activity-ticker-label">LIVE ACTIVITY</div>
  <div class="activity-ticker-track">
    <div class="activity-ticker-inner">
      <!-- Duplicate items for seamless loop -->
      ${items.concat(items).map(item => `<span class="ticker-item">...</span>`)}
    </div>
  </div>
</div>
```
```css
.activity-ticker-inner {
  display: flex;
  white-space: nowrap;
  animation: tickerScroll 90s linear infinite;
}
.activity-ticker-inner:hover { animation-play-state: paused; }
@keyframes tickerScroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
```

---

## 4. Service Worker Lessons Learned

### CRITICAL: Service Workers Cache Everything
- Once registered, the SW intercepts ALL fetch requests and serves from cache
- Updating files on the server does NOT update what the browser sees
- Bumping the cache name only works if the browser fetches the NEW service-worker.js
- The old SW must complete its lifecycle before the new one activates
- **206 partial responses** (video range requests) crash `cache.put()` and can break the SW

### Safe Service Worker Strategy
1. Always use version strings in the cache name: `msp-shell-v20260717`
2. Add `Cache-Control: no-cache` headers for `service-worker.js` itself
3. Consider disabling SW during active development
4. Add a force-unregister script at top of `<body>` as a nuclear option:
```javascript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(r => r.forEach(sw => sw.unregister()));
  if (window.caches) caches.keys().then(k => k.forEach(n => caches.delete(n)));
}
```

---

## 5. FFmpeg Quick Reference

```bash
# Scale to 720p
ffmpeg -i in.mp4 -vf "scale=1280:720" -c:v libx264 -crf 26 -preset slow -an -movflags +faststart out.mp4

# Center crop for portrait (9:16 from 16:9)
ffmpeg -i in.mp4 -vf "crop=405:720:437:0,scale=390:694" -c:v libx264 -crf 28 out.mp4

# Add black padding (make logo smaller)
ffmpeg -i in.mp4 -vf "scale=900:505,pad=1080:1920:90:707:black" out.mp4

# Slow down 2.5x
ffmpeg -i in.mp4 -filter:v "setpts=2.5*PTS" out.mp4

# Check video info
ffprobe -v quiet -print_format json -show_streams in.mp4
```

---

## 6. Kling Downloads Folder
All generated videos are stored at:
```
/Volumes/Wotg Drive Mike/GitHub/kling-mcp-direct/downloads/
```

Files:
- `logo-intro-v3-1x1.mp4` — current logo intro (1:1 square, small logo)
- `fleet-repair-v1.mp4` / `fleet-repair-raw.mp4` — technician repair cinematic
- `marga-network-bg-v2.mp4` / `marga-network-bg-v2-raw.mp4` — network diagram animation
- `test-orb-001.mp4` — first Kling test
- Various logo intro attempts (v1, v2, small-A, small-B)
