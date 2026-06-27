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
 * initial page load). The film autoplays muted on open — the only autoplay
 * browsers allow without friction — and loops, so it never lands on YouTube's
 * branded end screen; the player's own UI handles unmuting. Under
 * prefers-reduced-motion we don't autoplay; the native controls start it.
 * Slots whose link isn't YouTube/Vimeo are left untouched.
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

// Build the embed URL, trimming each player's branding where allowed and muting
// the autoplay so browsers permit it. Both providers loop (YouTube's loop=1
// needs playlist set to the same id) so the film never lands on the branded
// end/outro screen. Trade-off on YouTube: each loop restart re-shows the control
// bar for ~3s, which there's no param to suppress.
function embedSrc(info, autoplay) {
    if (info.provider === 'youtube') {
        const params = ['rel=0', 'iv_load_policy=3', 'color=white', 'playsinline=1', 'loop=1', `playlist=${info.id}`];
        if (autoplay) params.push('autoplay=1', 'mute=1');
        return `https://www.youtube.com/embed/${info.id}?${params.join('&')}`;
    }
    const params = ['title=0', 'byline=0', 'portrait=0', 'loop=1'];
    if (autoplay) params.push('autoplay=1', 'muted=1');
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

// Load every YouTube/Vimeo embed in a panel when it opens. Only the first video
// block autoplays (and only when motion is welcome); the rest wait for a click.
// Autoplay is muted — the only autoplay browsers allow without friction — and
// the player's own UI handles unmuting. A slot's own data-title overrides the
// project title for the iframe's accessible name.
function loadPanelEmbeds(panel, title) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const body = panel.querySelector('.panel-body');
    panel.querySelectorAll('.media--video[data-href]').forEach((slot, i) => {
        if (slot.querySelector('iframe')) return; // already loaded
        const info = videoEmbed(slot.dataset.href);
        if (!info) return; // not YouTube/Vimeo — leave the slot untouched
        // Autoplay is reserved for a hero film that LEADS the panel — nothing
        // rendered above it. Put a dek, a still, or anything else first and every
        // film becomes click-to-play, so autoplay never fires off-screen.
        const autoplay = i === 0 && leadsPanel(slot, body) && !reduceMotion;
        slot.replaceChildren(makeIframe(embedSrc(info, autoplay), slot.dataset.title || title));
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
        if (slot.querySelector('iframe')) slot.replaceChildren();
    });
}
