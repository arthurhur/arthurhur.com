document.addEventListener('DOMContentLoaded', () => {
    const background = setupBackground();
    setupAccordion(background);
    setupJustifiedMedia();
});

/* ---- Justified media rows -------------------------------------------------
 * A .media-grid--justified lays its figures out with flex-grow proportional to
 * each image's aspect ratio, which makes every image in the row resolve to the
 * same height (bottoms + captions aligned) while the row still fills its width.
 * The proportion lives in a per-figure --ar custom property; we read it off the
 * image's natural dimensions once it loads (works through lazy-loading and the
 * collapsed accordion, since we key off the load event).
 */
function setupJustifiedMedia() {
    const figures = document.querySelectorAll('.media-grid--justified .figure');
    figures.forEach((figure) => {
        const media = figure.querySelector('img, video');
        if (!media) return;
        // Panel media now carries intrinsic width/height, so the ratio is known up
        // front — no wait, no reflow. Fall back to measured dimensions for anything
        // without them (img.naturalWidth / video.videoWidth).
        const w = +media.getAttribute('width');
        const h = +media.getAttribute('height');
        if (w && h) {
            figure.style.setProperty('--ar', (w / h).toFixed(4));
            return;
        }
        const apply = () => {
            const nw = media.naturalWidth || media.videoWidth;
            const nh = media.naturalHeight || media.videoHeight;
            if (nw && nh) figure.style.setProperty('--ar', (nw / nh).toFixed(4));
        };
        if (media.complete) apply();
        media.addEventListener('load', apply);
        media.addEventListener('loadedmetadata', apply);
    });
}

/* ---- Background crossfade -------------------------------------------------
 * Two double-buffered layers; paint the incoming still on the hidden one,
 * swap which is visible, then flip the references.
 *
 * A "pinned" image is the resting background. On pointer devices hover/focus
 * previews a film; on mouse-out/blur it settles back to whatever is pinned
 * (the open project's film, or the default when nothing is open). On touch,
 * scroll position (and touch-hold) drive the preview instead, emulating hover
 * (see setupTouchPreview). The accordion drives pinning in both cases.
 */
function setupBackground() {
    const layers = document.querySelectorAll('.bg-layer');
    if (layers.length < 2) {
        return { pin() {}, unpin() {} };
    }

    const defaultBg = getComputedStyle(document.documentElement)
        .getPropertyValue('--bg-default')
        .trim();

    let front = layers[0];
    let back = layers[1];
    let current = defaultBg;
    let pinned = defaultBg;

    front.style.backgroundImage = defaultBg;
    front.classList.add('is-visible');

    const show = (image) => {
        if (image === current) return;
        current = image;
        back.style.backgroundImage = image;
        back.classList.add('is-visible');
        front.classList.remove('is-visible');
        [front, back] = [back, front];
    };

    const canHover = window.matchMedia('(hover: hover)').matches;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timeoutId;
    let pinnedActive = false;   // a panel is open; its still owns the backdrop
    let touchPreview = null;    // touch-only hover emulation (see setupTouchPreview)

    const sources = document.querySelectorAll('main [data-bgimg]');

    if (canHover) {
        // Pointer devices: hover/focus previews a film, mouse-out settles back.
        sources.forEach((el) => {
            const image = `url("${el.dataset.bgimg}")`;

            const preview = () => {
                clearTimeout(timeoutId);
                show(image);
            };
            // Settle back to the pinned film, not the default, so an open project
            // stays on screen while you move into its panel or peek at other rows.
            const settle = () => {
                timeoutId = setTimeout(() => show(pinned), 200);
            };

            el.addEventListener('mouseover', preview);
            el.addEventListener('mouseout', settle);
            el.addEventListener('focus', preview);
            el.addEventListener('blur', settle);
        });
        // Warm the still cache off the critical path: once the browser goes idle
        // (after first render + fonts), preload each row's background in small
        // batches so the first hover is instant without delaying initial load.
        preloadWhenIdle([...sources].map((el) => el.dataset.bgimg));
    } else {
        // Touch devices have no hover, so warm each still just before it scrolls
        // into view, then emulate hover: a scroll line ~a third down the screen
        // (or a touch-hold) previews the row it lands on. Reduced-motion keeps the
        // warming but skips the scroll-driven swaps (they'd only hard-cut).
        preloadOnApproach(sources);
        if (!reduceMotion) {
            touchPreview = setupTouchPreview(sources, show, defaultBg, () => pinnedActive);
        }
    }

    return {
        // Pin a film as the resting background and show it immediately. A row
        // with no still (image falsy) pins the default, clearing the backdrop.
        pin(image) {
            pinnedActive = true;
            pinned = image || defaultBg;
            clearTimeout(timeoutId);
            if (touchPreview) touchPreview.clear();   // the open row owns the highlight now
            show(pinned);
        },
        // Stop pinning. On a pointer device, don't force a swap: if the cursor is
        // still on the row its film stays until you leave. On touch, fall back to
        // whatever the scroll line is previewing (or the default).
        unpin() {
            pinnedActive = false;
            pinned = defaultBg;
            if (touchPreview) touchPreview.resume();
            else if (!canHover) show(defaultBg);
        },
    };
}

/* Preload a list of image URLs during idle time, in small batches, so warming the
 * hover-background cache never competes with first render or font loading. */
function preloadWhenIdle(urls) {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    let i = 0;
    (function pump() {
        idle(() => {
            for (let n = 0; n < 3 && i < urls.length; n++, i++) new Image().src = urls[i];
            if (i < urls.length) pump();
        });
    })();
}

/* ---- Still preloading (touch) ---------------------------------------------
 * Warm each row's background once it comes within ~2 screens, then stop watching
 * it, so a phone isn't fetching all 27 stills up front. */
function preloadOnApproach(sources) {
    const pre = new IntersectionObserver((entries, obs) => {
        entries.forEach((e) => {
            if (e.isIntersecting) {
                new Image().src = e.target.dataset.bgimg;
                obs.unobserve(e.target);
            }
        });
    }, { rootMargin: '200% 0px' });
    sources.forEach((el) => pre.observe(el));
}

/* ---- Touch hover-emulation -------------------------------------------------
 * No pointer on touch, so stand in for hover: the row crossing a line ~a third
 * down the viewport — or one held under a finger — takes the hover look (the
 * .is-active class highlights and indents it) and its still fades in, all without
 * committing. A genuine tap opens the row (the accordion pins its still); a hold
 * or a scroll only previews, so we swallow that click. Suspended while a panel is
 * open (the pinned still owns the screen). Returns { clear, resume }: the
 * background drops the highlight on open and restores it on close.
 */
function setupTouchPreview(sources, show, defaultBg, isPinned) {
    const items = [...sources];
    const imageOf = (el) => `url("${el.dataset.bgimg}")`;
    let active = null;

    const setActive = (row) => {
        if (row === active) return;
        if (active) active.classList.remove('is-active');
        active = row;
        if (active) active.classList.add('is-active');
        if (!isPinned()) show(active ? imageOf(active) : defaultBg);
    };

    // A zero-height band at the line names the row to preview; when more than one
    // straddles it, pick whichever's centre is nearest.
    const LINE = 33;   // percent from the top
    const centred = new Set();
    const pickFromLine = () => {
        if (isPinned()) return;
        const line = window.innerHeight * (LINE / 100);
        if (centred.size) {
            let best = null;
            let bestDist = Infinity;
            centred.forEach((el) => {
                const r = el.getBoundingClientRect();
                const dist = Math.abs((r.top + r.bottom) / 2 - line);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = el;
                }
            });
            setActive(best);
        } else if (!items.length || items[0].getBoundingClientRect().top > line) {
            setActive(null);   // scrolled above the first row — clean default
        }
    };

    const band = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
            if (e.isIntersecting) centred.add(e.target);
            else centred.delete(e.target);
        });
        pickFromLine();
    }, { rootMargin: `-${LINE}% 0px -${100 - LINE}% 0px`, threshold: 0 });
    items.forEach((el) => band.observe(el));

    // Tap vs. hold: a quick, still touch is left to fire its click (the accordion
    // opens the row); a longer press or a drag is preview-only. A capture-phase
    // listener on the document drops that click before the accordion's row
    // handler sees it. Reset on each touchstart so a stale flag can't eat a tap.
    const TAP_MS = 250, TAP_SLOP = 10;
    let downAt = 0, downX = 0, downY = 0, suppressClick = false;

    items.forEach((row) => {
        row.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            downAt = Date.now();
            downX = t.clientX;
            downY = t.clientY;
            suppressClick = false;
            if (!isPinned()) setActive(row);
        }, { passive: true });

        row.addEventListener('touchend', (e) => {
            const t = e.changedTouches[0];
            const moved = Math.hypot(t.clientX - downX, t.clientY - downY) > TAP_SLOP;
            if (moved || Date.now() - downAt > TAP_MS) suppressClick = true;
        }, { passive: true });
    });

    document.addEventListener('click', (e) => {
        if (suppressClick && e.target.closest('.row')) {
            e.stopPropagation();
            e.preventDefault();
            suppressClick = false;
        }
    }, true);

    return {
        // The newly-opened row owns the highlight; drop any preview indent.
        clear() {
            if (active) active.classList.remove('is-active');
            active = null;
        },
        // Back to browsing: repaint whatever the line is now over.
        resume() { pickFromLine(); },
    };
}

/* ---- Accordion ------------------------------------------------------------
 * Each project's panel is written inline after its row in index.html; here we
 * wire ARIA and toggle one open at a time. Opening a project pins its film and
 * lazy-loads every YouTube/Vimeo embed in its panel (only the first autoplays);
 * closing (or opening another) un-pins and unloads the embeds so playback stops.
 */
function setupAccordion(background) {
    const rows = [...document.querySelectorAll('.row')];

    rows.forEach((row, i) => {
        // The button is wrapped in an <h3> heading, so its panel is the
        // heading's next sibling (not the button's).
        const panel = row.parentElement.nextElementSibling;
        if (!panel || !panel.classList.contains('panel')) return;

        const id = `panel-${i + 1}`;
        const title = row.querySelector('.title').textContent;

        panel.id = id;
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', `${title} — details`);

        row.setAttribute('aria-controls', id);
        row.setAttribute('aria-expanded', 'false');

        row.addEventListener('click', () => {
            const isOpen = row.getAttribute('aria-expanded') === 'true';
            const willOpen = !isOpen;

            // If another row is open above this one, collapsing it shrinks the page
            // above the row we just clicked and carries it upward — past the top of the
            // screen and out of view. Let it ride up with the collapse, but clamp it at
            // the top so it stops there instead of sailing off (see holdRowAtTop). (Only
            // when opening; on close the clicked row's own panel is below it, so it
            // doesn't move.)
            const hadOtherOpen = rows.some(
                (r) => r !== row && r.getAttribute('aria-expanded') === 'true');

            // Single-open: collapse any other expanded row and stop its film(s).
            rows.forEach((other) => {
                if (other !== row) {
                    other.setAttribute('aria-expanded', 'false');
                    const otherPanel = other.parentElement.nextElementSibling;
                    otherPanel.classList.remove('open');
                    unloadEmbeds(otherPanel);
                }
            });

            row.setAttribute('aria-expanded', String(willOpen));
            panel.classList.toggle('open', willOpen);

            if (willOpen) {
                if (hadOtherOpen) holdRowAtTop(row);
                loadPanelEmbeds(panel, title);
                const bgimg = row.dataset.bgimg;
                background.pin(bgimg ? `url("${bgimg}")` : '');
            } else {
                unloadEmbeds(panel);
                background.unpin();
            }
        });
    });
}

// As a sibling panel above `row` animates closed, the row rides upward with the
// shrinking page. Let that ride happen, but don't let the row climb past the top of
// the viewport and out of view: clamp it there so it "scrolls up and stops at the
// top". One-sided — we only scroll when the row has risen above the line (drift < 0),
// pulling it back down to the line, so below it the upward motion still tracks the
// 0.35s collapse untouched. Runs once synchronously (covers reduced-motion's instant
// collapse) then each frame until the transition has run.
function holdRowAtTop(row) {
    const TOP_GAP = 0; // viewport-top offset the row stops at (its own padding adds air)
    const deadline = performance.now() + 450; // a hair past the 0.35s collapse
    const step = (now) => {
        const drift = row.getBoundingClientRect().top - TOP_GAP;
        if (drift < 0) window.scrollBy(0, drift); // risen above the line — pull back to it
        if (now < deadline) requestAnimationFrame(step);
    };
    step(performance.now());
}

/* ---- Video embeds ---------------------------------------------------------
 * Map a project's watch link to a YouTube/Vimeo embed, loaded only when the
 * panel opens (keeps a dozen-odd players and their third-party scripts off the
 * initial page load). A film that LEADS its panel autoplays muted on open — the
 * only autoplay browsers allow without friction; non-leading films wait for a
 * click. An autoplaying film loops as ambient background; a clicked film plays
 * once. Under prefers-reduced-motion nothing autoplays. Slots whose link isn't
 * YouTube/Vimeo are left untouched.
 *
 * Every film plays through its provider's player API, so sound and playback answer to
 * one set of rules whichever it is: one film at a time (activePlayers), and one session
 * sound preference (soundOn) that every mute/unmute writes to. YouTube runs controls=0
 * so it stays chrome-free (a seek/replay re-arms its bar, so it can only be kept hidden
 * by removing it); with no native volume button it carries our own sound control
 * (buildSoundControls). Vimeo keeps its native controls and wears that same control as
 * a one-shot gate over a muted lead, then hands off (see mountVimeo).
 */
function videoEmbed(href) {
    let url;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
        const id = url.pathname.slice(1);
        return id ? { id, provider: 'youtube' } : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
        const v = url.searchParams.get('v');
        if (v) return { id: v, provider: 'youtube' };
        // Shorts/embed/live/v URLs carry the id in the path, not a ?v= param.
        const [kind, id] = url.pathname.split('/').filter(Boolean);
        if (id && (kind === 'shorts' || kind === 'embed' || kind === 'live' || kind === 'v')) {
            return { id, provider: 'youtube', short: kind === 'shorts' };
        }
        return null;
    }
    if (host === 'vimeo.com') {
        const id = url.pathname.split('/').filter(Boolean)[0];
        return /^\d+$/.test(id) ? { id, provider: 'vimeo' } : null;
    }
    if (host === 'player.vimeo.com') {
        const id = url.pathname.split('/').filter(Boolean).pop();
        return /^\d+$/.test(id) ? { id, provider: 'vimeo' } : null;
    }
    return null;
}

// Build the embed URL for a plain iframe, trimming each player's branding where allowed
// and muting the autoplay so browsers permit it. Both API mounts build their player's
// iframe from this, and both fall back to it untouched when their API can't load — so it
// has to stand on its own. YouTube always loops (loop=1 needs playlist set to the same id)
// so it never lands on a branded end screen; Vimeo loops only when it autoplays, so a
// clicked Vimeo plays once. Leading films autoplay muted; non-leading films wait for a
// click (then play with sound). Native controls stay ON here even for YouTube, whose API
// player runs controls=0: with no API there's no sound control of ours to attach, and a
// muted autoplay with no control bar is a film nobody can unmute. A loop restart flashing
// YouTube's bar is the cheaper cost on a path that only appears when the script is blocked.
function embedSrc(info, autoplay) {
    if (info.provider === 'youtube') {
        const params = ['rel=0', 'iv_load_policy=3', 'playsinline=1', 'loop=1', `playlist=${info.id}`];
        if (autoplay) params.push('autoplay=1', 'mute=1');
        return `https://www.youtube.com/embed/${info.id}?${params.join('&')}`;
    }
    const params = ['title=0', 'byline=0', 'portrait=0', 'playsinline=1'];
    if (autoplay) params.push('autoplay=1', 'muted=1', 'loop=1');
    return `https://player.vimeo.com/video/${info.id}?${params.join('&')}`;
}

function makeIframe(src, title) {
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.title = title;
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    return iframe;
}

/* ---- Hero YouTube player ---------------------------------------------------
 * The IFrame Player API, loaded lazily on the first hero film (never at page
 * load). Memoised: the window.YT check up top lets a later open recover even if
 * an earlier attempt timed out. Rejects on error/timeout so the caller can fall
 * back to a plain autoplay iframe.
 */
let ytApiPromise;
function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise((resolve, reject) => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            if (typeof prev === 'function') prev();
            resolve(window.YT);
        };
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.onerror = () => reject(new Error('YT API failed to load'));
        document.head.appendChild(tag);
        setTimeout(() => reject(new Error('YT API load timed out')), 4000);
    });
    return ytApiPromise;
}

// Custom sound control for a controls-free player (which has no native volume button).
// A transparent overlay over the player catches clicks while muted: a click anywhere
// unmutes — the whole film is a tap-to-unmute target. Once unmuted the overlay goes
// click-through (CSS), so clicks reach the player again (pause / toggle chrome); only
// the speaker button mutes back, and only while playing. The speaker is a sibling of
// the overlay (not nested) so it stays tappable when the overlay is click-through.
// Muted: the speaker shows persistently (it invites the tap). Unmuted: it tucks away
// and reappears on hover, the way player chrome does (CSS). `controls` is a small
// provider-agnostic adapter — { unmute(), mute(), isPlaying() } — so YouTube and Vimeo
// share one path through the sound state. Options:
//   startMuted — false for a film the viewer chose to play (it starts with sound on).
//   oneShot    — a bare gate for a player with native chrome of its own (Vimeo): no
//                speaker of ours, since Vimeo already shows an Unmute pill over a muted
//                autoplay and its bar carries a speaker after — a second one would just
//                double up. The first unmute removes the gate and calls onUnmute, handing
//                off. mute()/isPlaying() are unreachable in that mode, so they're optional.
// Session sound preference: once the viewer unmutes any film, later films open
// with sound too (and muting one carries the silence forward). Set here, and mirrored
// from Vimeo's native speaker after a handoff (mountVimeo); read at mount time.
let soundOn = false;

// Carrying sound onto a new lead means unmuting from the player's ready callback —
// long after the tap that opened the panel, so there's no user gesture attached.
// Mobile autoplay policy refuses a gestureless unmute and pauses the film outright
// (desktop allows it via the page's sticky activation). So the unmute is an
// attempt: each mount verifies playback survived it, and the first block flips
// this flag so later leads skip straight to muted autoplay + tap-to-unmute.
let autoUnmuteBlocked = false;

const ICON_MUTED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
function buildSoundControls(slot, controls, { startMuted = true, oneShot = false, onUnmute } = {}) {
    let muted = startMuted;

    const overlay = document.createElement('div');
    overlay.className = 'media__sound';
    // A one-shot gate is invisible chrome — it hands off to a player that has its own.
    const button = oneShot ? null : document.createElement('button');
    if (button) {
        button.type = 'button';
        button.className = 'media__mute';
    }

    const render = () => {
        slot.classList.toggle('is-unmuted', !muted); // drives the overlay's click-through + button CSS
        if (!button) return;
        button.innerHTML = muted ? ICON_MUTED : ICON_SOUND;
        button.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    };
    render();

    const unmute = () => {
        if (!muted) return;
        controls.unmute();
        muted = false;
        soundOn = true; // carry sound to films opened afterward
        if (oneShot) {
            // Hand off: drop the gate so the player's own controls take over.
            overlay.remove();
            if (onUnmute) onUnmute();
            return;
        }
        render();
    };
    // Mute is only reachable via the speaker, and only while playing.
    const mute = () => {
        if (muted || (controls.isPlaying && !controls.isPlaying())) return;
        controls.mute();
        muted = true;
        soundOn = false; // and carry the silence forward
        render();
    };

    overlay.addEventListener('click', unmute); // click anywhere unmutes; no-op once on
    slot.appendChild(overlay);
    if (button) {
        button.addEventListener('click', (e) => {
            e.stopPropagation(); // don't let the overlay re-unmute the click that just muted
            muted ? unmute() : mute();
        });
        slot.appendChild(button); // sibling of the overlay so it stays tappable when the overlay is click-through
    }

    // For the caller's unmute-attempt recovery: flip the UI back to muted without
    // touching soundOn (the viewer's preference stands; the platform refused it).
    return { forceMuted: () => { muted = true; render(); } };
}

// Every live API player in the open panel (YouTube or Vimeo, autoplaying or clicked).
// When one starts playing it pauses the rest, so only one film plays at a time.
const activePlayers = new Set();
function pauseOtherPlayers(current) {
    activePlayers.forEach((p) => {
        if (p === current) return;
        try {
            const done = (p.pauseVideo || p.pause).call(p);
            if (done && done.catch) done.catch(() => {}); // Vimeo's pause is a promise
        } catch (_) { /* player already gone */ }
    });
}

// Mount a controls-free (controls=0) YouTube player with our own sound overlay
// (buildSoundControls), so the film stays clean and still has a volume control. A
// leading film autoplays muted (the overlay's click-anywhere unmutes) and loops as
// ambient background — we own the loop (ENDED → seek 0 + play) so it restarts without
// flashing chrome. A clicked film loads paused, plays with sound (starts unmuted,
// speaker mutes), and plays once. A teardown stored on the slot destroys the player
// when the panel closes. If the API can't load, fall back to a plain iframe — which
// carries YouTube's native controls, since our sound overlay needs the API (see embedSrc).
function mountYouTube(slot, info, title, autoplay) {
    const mount = document.createElement('div'); // YT replaces this node with its iframe
    slot.replaceChildren(mount);

    let player = null;
    let destroyed = false;

    slot._playerTeardown = () => {
        destroyed = true;
        if (player) {
            activePlayers.delete(player);
            if (typeof player.destroy === 'function') player.destroy();
        }
        player = null;
    };

    loadYouTubeApi().then((YT) => {
        if (destroyed) return;
        player = new YT.Player(mount, {
            videoId: info.id,
            // controls: 0 — the only way to keep the player clean. A loop restart
            // (seek/replay) re-arms YouTube's control bar, so with controls on it
            // would flash on every loop; there's no param to suppress just that.
            playerVars: { autoplay: autoplay ? 1 : 0, mute: autoplay ? 1 : 0, controls: 0, rel: 0, iv_load_policy: 3, playsinline: 1 },
            events: {
                onReady: (e) => {
                    if (destroyed) return;
                    activePlayers.add(e.target);
                    // A lead autoplays muted (policy), a clicked film starts unmuted —
                    // but once the session is unmuted, leads open with sound too: they
                    // still autoplay muted, then unmute the moment they're ready. That
                    // ready-time unmute has no gesture attached, so a mobile-style
                    // policy refuses it and pauses the film; verify playback shortly
                    // after and fall back to muted autoplay if it was blocked (see
                    // autoUnmuteBlocked above).
                    const attemptSound = autoplay && soundOn && !autoUnmuteBlocked;
                    const startMuted = autoplay && !attemptSound;
                    const soundUI = buildSoundControls(slot, {
                        mute: () => e.target.mute(),
                        unmute: () => e.target.unMute(),
                        isPlaying: () => e.target.getPlayerState() === YT.PlayerState.PLAYING,
                    }, { startMuted });
                    if (attemptSound) {
                        e.target.unMute();
                        setTimeout(() => {
                            if (destroyed) return;
                            const state = e.target.getPlayerState();
                            if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) return;
                            autoUnmuteBlocked = true; // remember: skip the attempt on later leads
                            e.target.mute();
                            soundUI.forceMuted();     // back to the tap-to-unmute affordance
                            e.target.playVideo();     // muted play needs no gesture
                        }, 2500);
                    }
                },
                onStateChange: (e) => {
                    if (destroyed) return;
                    if (e.data === YT.PlayerState.PLAYING) {
                        pauseOtherPlayers(e.target); // one film at a time
                    } else if (e.data === YT.PlayerState.ENDED && autoplay) {
                        e.target.seekTo(0, true); // ambient autoplay loops; a clicked film plays once
                        e.target.playVideo();
                    }
                },
            },
        });
    }).catch(() => {
        if (destroyed) return;
        slot._playerTeardown = null;
        slot.replaceChildren(makeIframe(embedSrc(info, autoplay), slot.dataset.title || title));
    });
}

// Vimeo's Player API, loaded lazily on the first autoplaying Vimeo lead. Memoised;
// rejects on error/timeout so the caller can fall back to a plain iframe.
let vimeoApiPromise;
function loadVimeoApi() {
    if (window.Vimeo && window.Vimeo.Player) return Promise.resolve(window.Vimeo);
    if (vimeoApiPromise) return vimeoApiPromise;
    vimeoApiPromise = new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = 'https://player.vimeo.com/api/player.js';
        tag.onload = () => (window.Vimeo && window.Vimeo.Player) ? resolve(window.Vimeo) : reject(new Error('Vimeo API missing'));
        tag.onerror = () => reject(new Error('Vimeo API failed to load'));
        document.head.appendChild(tag);
        setTimeout(() => reject(new Error('Vimeo API load timed out')), 4000);
    });
    return vimeoApiPromise;
}

// Mount a Vimeo film through Vimeo's Player API — every one, autoplaying or clicked, so
// they all join activePlayers and one film at a time still holds (a plain iframe has no
// API to pause). An autoplaying lead runs like the YouTube hero: muted, looping, under
// the same sound control (buildSoundControls), except it's a one-shot gate — the first
// click unmutes and takes our chrome away, handing off to Vimeo's native controls for
// pause/scrub/fullscreen. We keep those because background mode hides all chrome but is
// non-interactive, and controls=0 isn't reliably honored; the native bar auto-hides
// during the muted autoplay (the gate blocks hover) so it stays fairly clean until you
// engage. After the handoff Vimeo's own speaker is the mute control, so watchNativeVolume
// mirrors it back into soundOn — otherwise muting here would be invisible to the session
// and the next lead would open loud. A clicked film gets no gate (it plays with sound,
// like a clicked YouTube) but the same mirroring once the viewer starts it. A teardown
// stored on the slot destroys the player when the panel closes. If the API can't load,
// fall back to a plain iframe with native controls.
function mountVimeo(slot, info, title, autoplay) {
    let player = null;
    let destroyed = false;
    let watchingVolume = false;

    slot._playerTeardown = () => {
        destroyed = true;
        if (player) {
            activePlayers.delete(player);
            if (typeof player.destroy === 'function') player.destroy(); // async; fire and forget
        }
        player = null;
    };

    // The embed goes up immediately and player.js wraps it when it arrives — the API is
    // only there to control a film that's already loading. (It attaches to an existing
    // Vimeo iframe, so nothing reloads.) Direct child of the slot so .media--video sizing applies.
    const iframe = makeIframe(embedSrc(info, autoplay), slot.dataset.title || title);
    slot.replaceChildren(iframe);

    loadVimeoApi().then((Vimeo) => {
        if (destroyed) return;
        player = new Vimeo.Player(iframe);
        activePlayers.add(player);

        // Mirror Vimeo's native speaker into the session preference, the way our own
        // speaker does (buildSoundControls). volumechange is the hook for it: Vimeo's
        // mute button leaves the volume alone and flips `muted`, so read that (and fall
        // back to the volume for a slider dragged to zero, or a player.js too old to
        // report it). Attached only once the viewer is in charge of the sound, so our own
        // setMuted calls (the muted autoplay, the blocked-unmute fallback below) can't
        // clobber the preference behind their back.
        const watchNativeVolume = () => {
            if (watchingVolume || destroyed) return;
            watchingVolume = true;
            player.on('volumechange', ({ volume, muted }) => { soundOn = !muted && volume > 0; });
        };

        player.on('play', () => {
            pauseOtherPlayers(player); // one film at a time
            // A clicked film starts with sound and no gate, so there's nothing to hand
            // off — but from the moment the viewer plays it, its native speaker is a
            // sound choice like any other and belongs in the session preference.
            if (!autoplay) watchNativeVolume();
        });

        // Fit the frame to the film's true aspect when it isn't 16:9 (old SD videos),
        // unless the author pinned a ratio. data-ratio (loadPanelEmbeds) wins.
        if (!slot.dataset.ratio) {
            Promise.all([player.getVideoWidth(), player.getVideoHeight()])
                .then(([w, h]) => { if (!destroyed && w && h) slot.style.aspectRatio = `${w} / ${h}`; })
                .catch(() => { /* keep the default 16:9 */ });
        }

        // A clicked film plays with sound on its own controls — nothing to gate.
        if (!autoplay) return;

        // One-shot tap-to-unmute gate: the same click-anywhere overlay a muted YouTube
        // lead wears (minus our speaker — Vimeo shows its own Unmute pill), which then
        // steps aside for Vimeo's native controls.
        const addGate = () => buildSoundControls(slot, {
            unmute: () => player.setMuted(false),
        }, { oneShot: true, onUnmute: watchNativeVolume });

        if (soundOn && !autoUnmuteBlocked) {
            // Session already unmuted — open with sound, no gate. Same caveat as the
            // YouTube mount: this gestureless unmute gets refused (and playback
            // paused) under a mobile-style policy, so verify and fall back.
            player.setMuted(false);
            setTimeout(() => {
                if (destroyed) return;
                player.getPaused().then((paused) => {
                    if (destroyed) return;
                    if (!paused) {
                        watchNativeVolume(); // sound stuck — the native speaker owns it now
                        return;
                    }
                    autoUnmuteBlocked = true;
                    player.setMuted(true);
                    player.play().catch(() => {});
                    addGate();
                }).catch(() => {});
            }, 2500);
        } else {
            addGate();
        }
    }, () => {
        // No API — the iframe above stands on its own (native controls, and a muted
        // looping autoplay if it leads). Drop the teardown: there's no player to destroy,
        // so unloadEmbeds just clears the slot. (A rejection handler rather than .catch,
        // so a throw inside the mount above can't strand a live player untearable.)
        slot._playerTeardown = null;
    });
}

// Load every YouTube/Vimeo embed in a panel when it opens. At most one film
// autoplays — the first that wants to, and only when motion is welcome; the rest wait
// for a click. A film's data-autoplay ("on"/"off") overrides the positional default
// (a film that LEADS the panel autoplays). Every film goes through its provider's API
// player — mountYouTube (controls-free, our sound control) or mountVimeo (native
// controls, one-shot unmute gate on a lead) — so all of them share the one-at-a-time
// registry and the session sound preference. A slot's own data-title overrides the
// project title for the accessible name.
function loadPanelEmbeds(panel, title) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const body = panel.querySelector('.panel-body');
    let autoplayed = false; // only the first film that wants autoplay gets it
    panel.querySelectorAll('.media--video[data-href]').forEach((slot, i) => {
        // data-ratio (e.g. "4/3" or "4:3") overrides the default 16:9 frame for films
        // shot in another aspect, so the slot fits the video instead of pillarboxing it.
        if (slot.dataset.ratio) slot.style.aspectRatio = slot.dataset.ratio.replace(':', '/');
        if (slot.querySelector('iframe') || slot._playerTeardown) return; // already loaded
        const info = videoEmbed(slot.dataset.href);
        if (!info) return; // not YouTube/Vimeo — leave the slot untouched
        // Shorts are vertical; .media--short frames them 9:16 and caps their height
        // (see CSS) unless the author pinned data-ratio.
        if (info.short && !slot.dataset.ratio) slot.classList.add('media--short');
        // data-autoplay="on"/"off" is an explicit toggle; without it, a film autoplays
        // only if it LEADS the panel (nothing rendered above it), so a dek or still
        // first makes a film click-to-play unless it opts back in with data-autoplay="on".
        const wants = slot.dataset.autoplay === 'on' ? true
            : slot.dataset.autoplay === 'off' ? false
            : i === 0 && leadsPanel(slot, body);
        const autoplay = wants && !autoplayed && !reduceMotion;
        if (autoplay) autoplayed = true;
        if (info.provider === 'youtube') {
            mountYouTube(slot, info, title, autoplay);
        } else {
            mountVimeo(slot, info, title, autoplay);
        }
    });

    // Local looping clips (former GIFs): lazy by design — the <source> has only a
    // data-src, so nothing loads until the panel opens. Wire the real src now, then
    // play muted and loop. Reduced motion leaves the poster still.
    if (!reduceMotion) {
        panel.querySelectorAll('video.gifv').forEach((v) => {
            const source = v.querySelector('source[data-src]');
            if (source && !source.src) {
                source.src = source.dataset.src;
                v.load();
            }
            v.play().catch(() => {});
        });
    }
}

// True when `el` is the very first thing in `container`: no element precedes it
// at any level up the tree (so a film that's the first item of a leading grid
// still counts as leading the panel).
function leadsPanel(el, container) {
    let node = el;
    while (node && node !== container) {
        if (node.previousElementSibling) return false;
        node = node.parentElement;
    }
    return node === container;
}

// Tear down every player when a panel collapses, so playback stops and the next
// open starts from clean slots.
function unloadEmbeds(panel) {
    if (!panel) return;
    panel.querySelectorAll('.media--video').forEach((slot) => {
        // Tear down an API player first (destroys it so playback stops), then
        // clear the slot — destroy leaves its iframe node behind.
        if (typeof slot._playerTeardown === 'function') {
            slot._playerTeardown();
            slot._playerTeardown = null;
            slot.replaceChildren();
            slot.classList.remove('is-unmuted'); // the sound-state class lives on the persistent slot now
        } else if (slot.querySelector('iframe')) {
            slot.replaceChildren();
        }
    });
    // Pause the local looping clips so a collapsed panel isn't decoding video.
    panel.querySelectorAll('video.gifv').forEach((v) => v.pause());
}
