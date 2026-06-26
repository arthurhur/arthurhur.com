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
        // Pin a film as the resting background and show it immediately.
        pin(image) {
            pinned = image;
            clearTimeout(timeoutId);
            show(image);
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
 * one open at a time. Opening a project pins its film; closing un-pins.
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
        panel.querySelector('.watch').href = row.dataset.href;

        row.setAttribute('aria-controls', id);
        row.setAttribute('aria-expanded', 'false');
        row.after(panel);

        row.addEventListener('click', () => {
            const isOpen = row.getAttribute('aria-expanded') === 'true';

            // Single-open: collapse any other expanded row.
            rows.forEach((other) => {
                if (other !== row) {
                    other.setAttribute('aria-expanded', 'false');
                    other.nextElementSibling.classList.remove('open');
                }
            });

            row.setAttribute('aria-expanded', String(!isOpen));
            panel.classList.toggle('open', !isOpen);

            if (isOpen) {
                background.unpin();
            } else {
                background.pin(`url("${row.dataset.bgimg}")`);
            }
        });
    });
}
