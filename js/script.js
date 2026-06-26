document.addEventListener('DOMContentLoaded', () => {
    const background = setupBackground();
    setupAccordion(background);
});

/* ---- Background crossfade -------------------------------------------------
 * Two double-buffered layers; paint the incoming still on the hidden one,
 * swap which is visible, then flip the references.
 *
 * A "pinned" image is the resting background. Hover/focus previews a film;
 * on mouse-out/blur it settles back to whatever is pinned (the open project's
 * film, or the default when nothing is open). The accordion drives pinning.
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
    let timeoutId;

    document.querySelectorAll('main [data-bgimg]').forEach((el) => {
        const image = `url("${el.dataset.bgimg}")`;

        if (canHover) {
            new Image().src = el.dataset.bgimg;
        }

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
