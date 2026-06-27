document.addEventListener('DOMContentLoaded', () => {
    const background = setupBackground();
    setupAccordion(background);
});

/* ---- Background crossfade -------------------------------------------------
 * Two double-buffered layers; paint the incoming still on the hidden one,
 * swap which is visible, then flip the references.
 *
 * A "pinned" image is the resting background. On pointer devices hover/focus
 * previews a film; on mouse-out/blur it settles back to whatever is pinned
 * (the open project's film, or the default when nothing is open). On touch,
 * scroll position drives the preview instead (see setupScrollReveal). The
 * accordion drives pinning in both cases.
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

    const sources = document.querySelectorAll('main [data-bgimg]');

    if (canHover) {
        // Pointer devices: hover/focus previews a film, mouse-out settles back.
        sources.forEach((el) => {
            const image = `url("${el.dataset.bgimg}")`;
            new Image().src = el.dataset.bgimg;

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
    } else if (!reduceMotion) {
        // Touch devices: the film for whichever row is centred fades in as you
        // scroll. Skipped under reduced-motion, where the crossfade is off and
        // changing the background on scroll would only hard-cut.
        setupScrollReveal(sources, show, defaultBg);
    }

    return {
        // Pin a film as the resting background and show it immediately. A row
        // with no still (image falsy) pins the default, clearing the backdrop.
        pin(image) {
            pinned = image || defaultBg;
            clearTimeout(timeoutId);
            show(pinned);
        },
        // Stop pinning. Don't force a swap: if the cursor is still on the row
        // its film stays until you leave, then it settles back to default.
        unpin() {
            pinned = defaultBg;
        },
    };
}

/* ---- Scroll-driven reveal (touch) -----------------------------------------
 * No hover on touch, so the film for whichever row sits at the vertical centre
 * of the viewport fades in as you scroll. A zero-height IntersectionObserver
 * band at centre names the active row cheaply (no per-frame scroll handler);
 * a second, wider band preloads each film just before it's needed.
 */
function setupScrollReveal(sources, show, defaultBg) {
    const items = [...sources];
    if (!items.length) return;

    const imageOf = (el) => `url("${el.dataset.bgimg}")`;

    // Preload each film once it comes within ~2 screens, then stop watching it,
    // so a phone isn't fetching all 27 stills up front.
    const preloader = new IntersectionObserver((entries, obs) => {
        entries.forEach((e) => {
            if (e.isIntersecting) {
                new Image().src = e.target.dataset.bgimg;
                obs.unobserve(e.target);
            }
        });
    }, { rootMargin: '200% 0px' });
    items.forEach((el) => preloader.observe(el));

    // Track which rows straddle the centre line; show the nearest one.
    const centred = new Set();
    const update = () => {
        const mid = window.innerHeight / 2;
        if (centred.size) {
            let best = null;
            let bestDist = Infinity;
            centred.forEach((el) => {
                const r = el.getBoundingClientRect();
                const dist = Math.abs((r.top + r.bottom) / 2 - mid);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = el;
                }
            });
            show(imageOf(best));
        } else if (items[0].getBoundingClientRect().top > mid) {
            // Scrolled back above the first row — restore the clean default.
            show(defaultBg);
        }
        // Otherwise we're in a gap or an open panel: keep the last film up.
    };

    const centre = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
            if (e.isIntersecting) centred.add(e.target);
            else centred.delete(e.target);
        });
        update();
    }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
    items.forEach((el) => centre.observe(el));
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
        const panel = row.nextElementSibling;
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

            // Single-open: collapse any other expanded row and stop its film(s).
            rows.forEach((other) => {
                if (other !== row) {
                    other.setAttribute('aria-expanded', 'false');
                    const otherPanel = other.nextElementSibling;
                    otherPanel.classList.remove('open');
                    unloadEmbeds(otherPanel);
                }
            });

            const willOpen = !isOpen;
            row.setAttribute('aria-expanded', String(willOpen));
            panel.classList.toggle('open', willOpen);

            if (willOpen) {
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

/* ---- Video embeds ---------------------------------------------------------
 * Map a project's watch link to a YouTube/Vimeo embed, loaded only when the
 * panel opens (keeps a dozen-odd players and their third-party scripts off the
 * initial page load). A film that LEADS its panel autoplays muted on open — the
 * only autoplay browsers allow without friction; non-leading films wait for a
 * click. An autoplaying film loops as ambient background; a clicked film plays
 * once. Under prefers-reduced-motion nothing autoplays. Slots whose link isn't
 * YouTube/Vimeo are left untouched.
 *
 * Every YouTube film plays through the IFrame Player API with controls=0 so it stays
 * chrome-free (a seek/replay re-arms its bar, so it can only be kept hidden by removing
 * it); with no native volume button it carries our own sound control (buildSoundControls).
 * An autoplaying Vimeo lead is wrapped by Vimeo's Player API too, with a one-time
 * overlay for click-anywhere-to-unmute that then hands off to Vimeo's native controls
 * (see mountVimeo). A clicked Vimeo stays on the simple-iframe path below.
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
        const id = url.searchParams.get('v');
        return id ? { id, provider: 'youtube' } : null;
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

// Build the embed URL, trimming each player's branding where allowed and muting the
// autoplay so browsers permit it. YouTube always loops (loop=1 needs playlist set to
// the same id) so it never lands on a branded end screen, and controls=0 keeps the
// loop restart from flashing the control bar (no param suppresses just that) while
// making non-leading films read like the hero. Vimeo loops only when it autoplays, so
// a clicked Vimeo plays once. Leading films autoplay muted; non-leading films wait for
// a click (then play with sound). This path is also the hero's fallback when the
// IFrame API can't load; the API player does the same.
function embedSrc(info, autoplay) {
    if (info.provider === 'youtube') {
        const params = ['rel=0', 'iv_load_policy=3', 'playsinline=1', 'loop=1', `playlist=${info.id}`, 'controls=0'];
        if (autoplay) params.push('autoplay=1', 'mute=1');
        return `https://www.youtube.com/embed/${info.id}?${params.join('&')}`;
    }
    const params = ['title=0', 'byline=0', 'portrait=0'];
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
// and reappears on hover, the way player chrome does (CSS). Pass startMuted=false for
// a film the viewer chose to play (it starts with sound on). `controls` is a small
// provider-agnostic adapter — { mute(), unmute(), isPlaying() } — so YouTube and Vimeo
// share this overlay.
const ICON_MUTED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
function buildSoundControls(slot, controls, startMuted = true) {
    let muted = startMuted;

    const overlay = document.createElement('div');
    overlay.className = 'media__sound';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media__mute';

    const render = () => {
        slot.classList.toggle('is-unmuted', !muted); // drives the overlay's click-through + button CSS
        button.innerHTML = muted ? ICON_MUTED : ICON_SOUND;
        button.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    };
    render();

    const unmute = () => {
        if (!muted) return;
        controls.unmute();
        muted = false;
        render();
    };
    // Mute is only reachable via the speaker, and only while playing.
    const mute = () => {
        if (muted || !controls.isPlaying()) return;
        controls.mute();
        muted = true;
        render();
    };

    overlay.addEventListener('click', unmute); // click anywhere unmutes; no-op once on
    button.addEventListener('click', (e) => {
        e.stopPropagation(); // don't let the overlay re-unmute the click that just muted
        muted ? unmute() : mute();
    });

    slot.appendChild(overlay);
    slot.appendChild(button); // sibling of the overlay so it stays tappable when the overlay is click-through
}

// Every live API player in the open panel (YouTube or Vimeo). When one starts playing
// it pauses the rest, so only one film plays at a time. (A clicked Vimeo is a plain
// iframe with no API, so it isn't tracked.)
const activePlayers = new Set();
function pauseOtherPlayers(current) {
    activePlayers.forEach((p) => {
        if (p === current) return;
        try { (p.pauseVideo || p.pause).call(p); } catch (_) { /* player already gone */ }
    });
}

// Mount a controls-free (controls=0) YouTube player with our own sound overlay
// (buildSoundControls), so the film stays clean and still has a volume control. A
// leading film autoplays muted (the overlay's click-anywhere unmutes) and loops as
// ambient background — we own the loop (ENDED → seek 0 + play) so it restarts without
// flashing chrome. A clicked film loads paused, plays with sound (starts unmuted,
// speaker mutes), and plays once. A teardown stored on the slot destroys the player
// when the panel closes. If the API can't load, fall back to a plain iframe (embedSrc
// keeps controls=0).
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
                    buildSoundControls(slot, {
                        mute: () => e.target.mute(),
                        unmute: () => e.target.unMute(),
                        isPlaying: () => e.target.getPlayerState() === YT.PlayerState.PLAYING,
                    }, autoplay); // autoplay starts muted; a clicked film starts unmuted
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

// Mount an autoplaying Vimeo lead like the YouTube hero: a muted, looping autoplay
// wrapped by Vimeo's Player API. A transparent one-time gate over it unmutes on the
// first click (the whole film is tap-to-unmute), then removes itself so Vimeo's native
// controls — including its own mute — take over for pause/scrub/fullscreen. We keep the
// native controls because background mode hides all chrome but is non-interactive, and
// controls=0 isn't reliably honored; the native bar auto-hides during the muted autoplay
// (the gate blocks hover) so it stays fairly clean until you engage. Only used for
// autoplay leads; a clicked Vimeo is a plain native-controls iframe too (see
// loadPanelEmbeds). A teardown stored on the slot destroys the player when the panel
// closes. If the API can't load, fall back to a plain autoplay iframe with native controls.
function mountVimeo(slot, info, title) {
    let player = null;
    let destroyed = false;

    slot._playerTeardown = () => {
        destroyed = true;
        if (player) {
            activePlayers.delete(player);
            if (typeof player.destroy === 'function') player.destroy(); // async; fire and forget
        }
        player = null;
    };

    loadVimeoApi().then((Vimeo) => {
        if (destroyed) return;
        const src = `https://player.vimeo.com/video/${info.id}?autoplay=1&muted=1&loop=1&title=0&byline=0&portrait=0&playsinline=1`;
        const iframe = makeIframe(src, slot.dataset.title || title); // direct child of the slot so the .media--video iframe sizing applies
        slot.replaceChildren(iframe);
        player = new Vimeo.Player(iframe);
        activePlayers.add(player);
        player.on('play', () => pauseOtherPlayers(player)); // one film at a time

        // One-time tap-to-unmute gate, then hand off to Vimeo's native controls.
        const gate = document.createElement('div');
        gate.className = 'media__sound';
        gate.addEventListener('click', () => { player.setMuted(false); gate.remove(); });
        slot.appendChild(gate);
    }).catch(() => {
        if (destroyed) return;
        slot._playerTeardown = null;
        slot.replaceChildren(makeIframe(embedSrc(info, true), slot.dataset.title || title));
    });
}

// Load every YouTube/Vimeo embed in a panel when it opens. At most one film
// autoplays — the first that wants to, and only when motion is welcome; the rest wait
// for a click. A film's data-autoplay ("on"/"off") overrides the positional default
// (a film that LEADS the panel autoplays). Every YouTube film runs through the
// controls-free IFrame API player (mountYouTube) so it stays clean and carries our
// sound control; an autoplaying Vimeo lead runs through mountVimeo (tap-to-unmute,
// then native controls), while a clicked Vimeo loads as a plain native-controls
// iframe. A slot's own data-title
// overrides the project title for the accessible name.
function loadPanelEmbeds(panel, title) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const body = panel.querySelector('.panel-body');
    let autoplayed = false; // only the first film that wants autoplay gets it
    panel.querySelectorAll('.media--video[data-href]').forEach((slot, i) => {
        if (slot.querySelector('iframe') || slot._playerTeardown) return; // already loaded
        const info = videoEmbed(slot.dataset.href);
        if (!info) return; // not YouTube/Vimeo — leave the slot untouched
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
        } else if (info.provider === 'vimeo' && autoplay) {
            mountVimeo(slot, info, title);
        } else {
            slot.replaceChildren(makeIframe(embedSrc(info, autoplay), slot.dataset.title || title));
        }
    });
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
}
