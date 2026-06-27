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
 * Clone the placeholder panel template after each row, wire ARIA, and toggle
 * one open at a time. Opening a project pins its film and lazy-loads its
 * YouTube/Vimeo embed; closing (or opening another) un-pins and unloads the
 * embed so playback stops.
 */
function setupAccordion(background) {
    const template = document.getElementById('panel-tpl');
    if (!template) return;

    const rows = [...document.querySelectorAll('.row')];

    rows.forEach((row, i) => {
        const panel = template.content.firstElementChild.cloneNode(true);
        const id = `panel-${i + 1}`;
        const title = row.querySelector('.title').textContent;

        panel.id = id;
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', `${title} — details`);

        row.setAttribute('aria-controls', id);
        row.setAttribute('aria-expanded', 'false');
        row.after(panel);

        row.addEventListener('click', () => {
            const isOpen = row.getAttribute('aria-expanded') === 'true';

            // Single-open: collapse any other expanded row and stop its film.
            rows.forEach((other) => {
                if (other !== row) {
                    other.setAttribute('aria-expanded', 'false');
                    const otherPanel = other.nextElementSibling;
                    otherPanel.classList.remove('open');
                    unloadEmbed(otherPanel);
                }
            });

            const willOpen = !isOpen;
            row.setAttribute('aria-expanded', String(willOpen));
            panel.classList.toggle('open', willOpen);

            if (willOpen) {
                loadEmbed(panel, row.dataset.href, title);
                const bgimg = row.dataset.bgimg;
                background.pin(bgimg ? `url("${bgimg}")` : '');
            } else {
                unloadEmbed(panel);
                background.unpin();
            }
        });
    });
}

/* ---- Video embeds ---------------------------------------------------------
 * Map a project's watch link to a YouTube/Vimeo embed, loaded only when the
 * panel opens (keeps a dozen-odd players and their third-party scripts off the
 * initial page load). The film autoplays muted on open — the only autoplay
 * browsers allow without friction — and the player's own UI handles unmuting.
 * Under prefers-reduced-motion we don't autoplay; the native controls start it.
 * Links that aren't YouTube/Vimeo are left as the placeholder.
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

// Build the embed URL, trimming each player's title/branding chrome where
// allowed and muting the autoplay so browsers permit it.
function embedSrc(info, autoplay) {
    if (info.provider === 'youtube') {
        const params = ['rel=0', 'iv_load_policy=3', 'color=white', 'playsinline=1'];
        if (autoplay) params.push('autoplay=1', 'mute=1');
        return `https://www.youtube.com/embed/${info.id}?${params.join('&')}`;
    }
    const params = ['title=0', 'byline=0', 'portrait=0'];
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

function loadEmbed(panel, href, title) {
    const slot = panel.querySelector('.media--video');
    if (!slot) return;

    const info = videoEmbed(href);
    if (!info) return; // not YouTube/Vimeo — leave the placeholder

    // Autoplay only when motion is welcome; otherwise the native controls start
    // it. Either way the autoplay is muted and the player's UI handles sound.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    slot.replaceChildren(makeIframe(embedSrc(info, !reduceMotion), title));
}

// Tear down the player (and its toggle) when a panel collapses, so playback
// stops and the next open starts from a clean slot.
function unloadEmbed(panel) {
    const slot = panel.querySelector('.media--video');
    if (!slot || !slot.querySelector('iframe')) return;

    const span = document.createElement('span');
    span.textContent = 'Video';
    slot.replaceChildren(span);
}
